from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx


def _build_screenshot_path() -> Path:
    out_dir = Path("./artifacts/screenshots")
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return out_dir / f"screen-{ts}.png"


def _powershell_escape(path: str) -> str:
    return path.replace("'", "''")


async def _capture_screenshot(_: dict[str, Any]) -> str:
    path = _build_screenshot_path()
    escaped = _powershell_escape(str(path.resolve()))
    cmd = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "Add-Type -AssemblyName System.Drawing;"
        "$bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"
        "$bmp=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height);"
        "$graphics=[System.Drawing.Graphics]::FromImage($bmp);"
        "$graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size);"
        f"$bmp.Save('{escaped}', [System.Drawing.Imaging.ImageFormat]::Png);"
        "$graphics.Dispose();$bmp.Dispose();"
    )

    proc = await asyncio.create_subprocess_exec(
        "powershell",
        "-NoProfile",
        "-Command",
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        err = stderr.decode("utf-8", errors="ignore").strip()
        return f"截图失败: {err or 'PowerShell执行错误'}"
    return f"截图成功，文件已保存: {path.as_posix()}"


async def _get_weather(args: dict[str, Any]) -> str:
    city = str(args.get("city", "北京")).strip() or "北京"
    unit = str(args.get("unit", "C")).strip().upper()

    url = f"https://wttr.in/{quote(city)}?format=j1"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10)) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return f"天气查询失败: {exc}"

    cur = (data.get("current_condition") or [{}])[0]
    desc = ((cur.get("weatherDesc") or [{}])[0].get("value") or "未知")
    temp_c = cur.get("temp_C", "?")
    temp_f = cur.get("temp_F", "?")
    humidity = cur.get("humidity", "?")
    feels_c = cur.get("FeelsLikeC", "?")
    feels_f = cur.get("FeelsLikeF", "?")

    if unit == "F":
        temp = f"{temp_f}F"
        feels = f"{feels_f}F"
    else:
        temp = f"{temp_c}C"
        feels = f"{feels_c}C"

    return (
        f"{city} 当前天气: {desc}，温度 {temp}，体感 {feels}，湿度 {humidity}%。"
    )


def _search(args: dict[str, Any]) -> str:
    query = str(args.get("query", "")).strip()
    if not query:
        return "请提供 query 参数。"
    return f"本地搜索工具示例结果: {query}"


def register_builtin_tools(registry: Any) -> None:
    registry.register(
        name="search",
        description="简单搜索工具，返回演示搜索结果",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
            },
            "required": ["query"],
        },
        handler=_search,
    )

    registry.register(
        name="get_weather",
        description="查询城市天气信息",
        parameters={
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "城市名，例如 北京/Shanghai"},
                "unit": {"type": "string", "description": "温度单位 C 或 F"},
            },
            "required": ["city"],
        },
        handler=_get_weather,
    )

    registry.register(
        name="take_screenshot",
        description="截取当前主屏幕并保存为 PNG 文件",
        parameters={
            "type": "object",
            "properties": {},
            "required": [],
        },
        handler=_capture_screenshot,
    )
