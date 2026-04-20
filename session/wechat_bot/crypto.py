"""AES-128-ECB encryption/decryption for WeChat media.

WeChat uses AES-128-ECB with PKCS7 padding for media encryption.
Keys come in two formats depending on media type:
  - Images: base64(raw 16 bytes)
  - Files/voice/video: base64(hex string of 16 bytes)

Requires: pycryptodome OR cryptography package.
"""

from __future__ import annotations

import base64
import re

_BLOCK_SIZE = 16


def _parse_key(aes_key_b64: str) -> bytes:
    """Parse base64-encoded AES key.

    Handles both encodings seen in WeChat protocol:
      - base64(raw 16 bytes) -> images
      - base64(hex of 16 bytes) -> files/voice/video

    Raises:
        ValueError: If key format is unrecognized.
    """
    decoded = base64.b64decode(aes_key_b64)
    if len(decoded) == _BLOCK_SIZE:
        return decoded
    if len(decoded) == 32 and re.fullmatch(rb"[0-9a-fA-F]{32}", decoded):
        return bytes.fromhex(decoded.decode("ascii"))
    raise ValueError(
        f"AES key must decode to 16 raw bytes or 32-char hex, got {len(decoded)} bytes"
    )


def _pkcs7_pad(data: bytes) -> bytes:
    """Apply PKCS7 padding to block boundary."""
    pad_len = _BLOCK_SIZE - len(data) % _BLOCK_SIZE
    return data + bytes([pad_len] * pad_len)


def _pkcs7_unpad(data: bytes) -> bytes:
    """Remove PKCS7 padding. Returns original bytes if padding is invalid."""
    if not data or len(data) % _BLOCK_SIZE != 0:
        return data
    pad_len = data[-1]
    if pad_len < 1 or pad_len > _BLOCK_SIZE:
        return data
    if data[-pad_len:] != bytes([pad_len]) * pad_len:
        return data
    return data[:-pad_len]


def _get_aes_cipher(key: bytes):
    """Get AES-ECB cipher, trying pycryptodome first, then cryptography."""
    try:
        from Crypto.Cipher import AES

        return AES.new(key, AES.MODE_ECB)
    except ImportError:
        pass

    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    return Cipher(algorithms.AES(key), modes.ECB())


def encrypt(data: bytes, aes_key_b64: str) -> bytes:
    """Encrypt data with AES-128-ECB + PKCS7 padding.

    Args:
        data: Raw plaintext bytes.
        aes_key_b64: Base64-encoded AES key.

    Returns:
        Encrypted bytes.
    """
    key = _parse_key(aes_key_b64)
    padded = _pkcs7_pad(data)

    try:
        from Crypto.Cipher import AES

        cipher = AES.new(key, AES.MODE_ECB)
        return cipher.encrypt(padded)
    except ImportError:
        pass

    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    cipher_obj = Cipher(algorithms.AES(key), modes.ECB())
    encryptor = cipher_obj.encryptor()
    return encryptor.update(padded) + encryptor.finalize()


def decrypt(data: bytes, aes_key_b64: str) -> bytes:
    """Decrypt AES-128-ECB data and remove PKCS7 padding.

    Args:
        data: Encrypted bytes.
        aes_key_b64: Base64-encoded AES key.

    Returns:
        Decrypted plaintext bytes.
    """
    key = _parse_key(aes_key_b64)
    decrypted: bytes | None = None

    try:
        from Crypto.Cipher import AES

        cipher = AES.new(key, AES.MODE_ECB)
        decrypted = cipher.decrypt(data)
    except ImportError:
        pass

    if decrypted is None:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        cipher_obj = Cipher(algorithms.AES(key), modes.ECB())
        decryptor = cipher_obj.decryptor()
        decrypted = decryptor.update(data) + decryptor.finalize()

    return _pkcs7_unpad(decrypted)
