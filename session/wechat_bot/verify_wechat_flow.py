"""WeChat connectivity verification script.

Checks in order:
1) QR code can be generated.
2) Optional scan login can complete.
3) API long-poll endpoint can be called after login/token.

Usage examples:
  python -m session.wechat_bot.verify_wechat_flow --base-url https://frp-van.com:25941 --verify-ssl false
  python -m session.wechat_bot.verify_wechat_flow --base-url https://frp-van.com:25941 --verify-ssl false --wait-login 120
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import httpx

from .protocol import WeChatProtocol
from .types import WeChatConfig


def _as_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


async def _check_qr(protocol: WeChatProtocol) -> tuple[str, str]:
    qr_id, scan_url = await protocol._fetch_qr()  # noqa: SLF001
    print(f"[ok] QR generated: qrcode_id={qr_id[:10]}...")
    print("[info] Scan URL/Content:")
    print(scan_url)
    return qr_id, scan_url


async def _check_login(
    protocol: WeChatProtocol,
    state_dir: Path,
    wait_login_s: int,
) -> bool:
    if protocol.token or protocol.load_state(state_dir):
        print("[ok] Existing token found in state.")
        return True

    if wait_login_s <= 0:
        print("[skip] Login check skipped (wait-login <= 0 and no token).")
        return False

    print(f"[info] Waiting for scan login up to {wait_login_s}s...")
    try:
        ok = await asyncio.wait_for(protocol.qr_login(), timeout=wait_login_s)
    except TimeoutError:
        print("[fail] Login timed out. Please scan and confirm on WeChat.")
        return False

    if ok:
        protocol.save_state(state_dir)
        print("[ok] Login success. Token saved.")
        return True

    print("[fail] Login failed.")
    return False


async def _check_api_poll(protocol: WeChatProtocol) -> bool:
    if not protocol.token:
        print("[skip] API poll check skipped (no token).")
        return False

    try:
        msgs = await protocol.poll()
        print(f"[ok] getupdates API reachable. msgs={len(msgs)}")
        return True
    except Exception as exc:
        print(f"[fail] getupdates API call failed: {exc}")
        return False


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://ilinkai.weixin.qq.com")
    parser.add_argument("--verify-ssl", default="true")
    parser.add_argument("--state-dir", default="./wechat_state")
    parser.add_argument("--poll-timeout", type=int, default=35)
    parser.add_argument("--wait-login", type=int, default=0)
    args = parser.parse_args()

    cfg = WeChatConfig(
        base_url=args.base_url.rstrip("/"),
        verify_ssl=_as_bool(args.verify_ssl),
        state_dir=args.state_dir,
        poll_timeout=args.poll_timeout,
    )
    protocol = WeChatProtocol(cfg)
    state_dir = cfg.resolved_state_dir

    protocol.client = httpx.AsyncClient(
        timeout=httpx.Timeout(cfg.poll_timeout + 10, connect=30),
        follow_redirects=True,
        verify=cfg.verify_ssl,
    )

    summary: dict[str, bool] = {
        "qr_generated": False,
        "login_success": False,
        "api_poll_ok": False,
    }

    try:
        await _check_qr(protocol)
        summary["qr_generated"] = True

        summary["login_success"] = await _check_login(
            protocol=protocol,
            state_dir=state_dir,
            wait_login_s=args.wait_login,
        )

        summary["api_poll_ok"] = await _check_api_poll(protocol)

        print("[summary]", json.dumps(summary, ensure_ascii=False))
        if summary["qr_generated"] and (summary["login_success"] and summary["api_poll_ok"]):
            return 0
        return 1
    finally:
        if protocol.client:
            await protocol.client.aclose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
