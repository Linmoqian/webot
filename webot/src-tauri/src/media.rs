use aes::cipher::{BlockEncrypt, KeyInit};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;

pub const CDN_BASE_URL: &str = "https://novac2c.cdn.weixin.qq.com/c2c";

const UPLOAD_MEDIA_IMAGE: u32 = 1;
const UPLOAD_MEDIA_VIDEO: u32 = 2;
const UPLOAD_MEDIA_FILE: u32 = 3;
const UPLOAD_MEDIA_VOICE: u32 = 4;

const ITEM_IMAGE: u32 = 2;
const ITEM_VOICE: u32 = 3;
const ITEM_FILE: u32 = 4;
const ITEM_VIDEO: u32 = 5;

const IMAGE_EXTS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".ico", ".svg",
];
const VIDEO_EXTS: &[&str] = &[".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv"];
const VOICE_EXTS: &[&str] = &[
    ".mp3", ".wav", ".amr", ".silk", ".ogg", ".m4a", ".aac", ".flac",
];

struct MediaTypeInfo {
    upload_type: u32,
    item_type: u32,
    item_key: &'static str,
}

fn detect_media_type(path: &std::path::Path) -> MediaTypeInfo {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let ext_lower = format!(".{}", ext.to_lowercase());

    if IMAGE_EXTS.contains(&ext_lower.as_str()) {
        MediaTypeInfo {
            upload_type: UPLOAD_MEDIA_IMAGE,
            item_type: ITEM_IMAGE,
            item_key: "image_item",
        }
    } else if VIDEO_EXTS.contains(&ext_lower.as_str()) {
        MediaTypeInfo {
            upload_type: UPLOAD_MEDIA_VIDEO,
            item_type: ITEM_VIDEO,
            item_key: "video_item",
        }
    } else if VOICE_EXTS.contains(&ext_lower.as_str()) {
        MediaTypeInfo {
            upload_type: UPLOAD_MEDIA_VOICE,
            item_type: ITEM_VOICE,
            item_key: "voice_item",
        }
    } else {
        MediaTypeInfo {
            upload_type: UPLOAD_MEDIA_FILE,
            item_type: ITEM_FILE,
            item_key: "file_item",
        }
    }
}

fn md5_hex(data: &[u8]) -> String {
    use md5::{Md5, Digest};
    let mut hasher = Md5::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn aes_ecb_encrypt(data: &[u8], key: &[u8; 16]) -> Vec<u8> {
    let pad_len = 16 - (data.len() % 16);
    let mut buf = data.to_vec();
    buf.extend(std::iter::repeat(pad_len as u8).take(pad_len));

    let cipher = aes::Aes128::new(key.into());
    for chunk in buf.chunks_exact_mut(16) {
        let mut block = *aes::cipher::generic_array::GenericArray::from_slice(
            chunk as &[u8],
        );
        cipher.encrypt_block(&mut block);
        chunk.copy_from_slice(&block);
    }
    buf
}

async fn get_upload_url(
    client: &reqwest::Client,
    base_url: &str,
    auth_headers: &reqwest::header::HeaderMap,
    file_key: &str,
    upload_type: u32,
    to_user_id: &str,
    raw_size: usize,
    raw_md5: &str,
    padded_size: usize,
    aes_key_hex: &str,
    base_info: &Value,
) -> Result<(String, String), String> {
    let body = serde_json::json!({
        "filekey": file_key,
        "media_type": upload_type,
        "to_user_id": to_user_id,
        "rawsize": raw_size,
        "rawfilemd5": raw_md5,
        "filesize": padded_size,
        "no_need_thumb": true,
        "aeskey": aes_key_hex,
        "base_info": base_info,
    });

    let resp = client
        .post(format!("{}/ilink/bot/getuploadurl", base_url))
        .headers(auth_headers.clone())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("getuploadurl 请求失败: {e}"))?;

    let data: Value = resp.json().await.map_err(|e| format!("解析 getuploadurl 响应失败: {e}"))?;

    let upload_full_url = data
        .get("upload_full_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let upload_param = data
        .get("upload_param")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if upload_full_url.is_empty() && upload_param.is_empty() {
        return Err(format!(
            "getuploadurl 未返回上传地址: {}",
            data.get("errmsg").and_then(|v| v.as_str()).unwrap_or("unknown")
        ));
    }

    Ok((upload_full_url, upload_param))
}

async fn upload_to_cdn(
    client: &reqwest::Client,
    upload_full_url: &str,
    upload_param: &str,
    file_key: &str,
    encrypted_data: &[u8],
) -> Result<String, String> {
    let url = if !upload_full_url.is_empty() {
        upload_full_url.to_string()
    } else {
        format!(
            "{}/upload?encrypted_query_param={}&filekey={}",
            CDN_BASE_URL,
            urlencoding(upload_param),
            urlencoding(file_key),
        )
    };

    let resp = client
        .post(&url)
        .header("Content-Type", "application/octet-stream")
        .body(encrypted_data.to_vec())
        .send()
        .await
        .map_err(|e| format!("CDN 上传失败: {e}"))?;

    let download_param = resp
        .headers()
        .get("x-encrypted-param")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if download_param.is_empty() {
        return Err(format!(
            "CDN 上传响应缺少 x-encrypted-param, status={}",
            resp.status()
        ));
    }

    Ok(download_param)
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

fn build_media_message_body(
    to_user_id: &str,
    context_token: &str,
    type_info: &MediaTypeInfo,
    download_param: &str,
    aes_key_hex: &str,
    padded_size: usize,
    raw_size: usize,
    file_name: &str,
    base_info: &Value,
) -> Value {
    let aes_key_b64 = BASE64.encode(aes_key_hex.as_bytes());

    let media = serde_json::json!({
        "encrypt_query_param": download_param,
        "aes_key": aes_key_b64,
        "encrypt_type": 1,
    });

    let item_content = match type_info.item_key {
        "image_item" => serde_json::json!({
            "media": media,
            "mid_size": padded_size,
        }),
        "video_item" => serde_json::json!({
            "media": media,
            "video_size": padded_size,
        }),
        "voice_item" => serde_json::json!({
            "media": media,
        }),
        _ => serde_json::json!({
            "media": media,
            "file_name": file_name,
            "len": raw_size.to_string(),
        }),
    };

    let item = serde_json::json!({
        "type": type_info.item_type,
        type_info.item_key: item_content,
    });

    serde_json::json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": format!("webot-{}", &uuid::Uuid::new_v4().to_string()[..12]),
            "message_type": 2,
            "message_state": 2,
            "item_list": [item],
            "context_token": context_token,
        },
        "base_info": base_info,
    })
}

pub async fn send_media_file(
    client: &reqwest::Client,
    base_url: &str,
    auth_headers: &reqwest::header::HeaderMap,
    to_user_id: &str,
    context_token: &str,
    file_path: &str,
    base_info: &Value,
) -> Result<(), String> {
    let path = std::path::Path::new(file_path);
    if !path.is_file() {
        return Err(format!("文件不存在: {file_path}"));
    }

    let raw_data = std::fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
    let raw_size = raw_data.len();
    let raw_md5 = md5_hex(&raw_data);
    let type_info = detect_media_type(path);

    let aes_key_bytes: [u8; 16] = *uuid::Uuid::new_v4().as_bytes();
    let aes_key_hex = hex::encode(aes_key_bytes);
    let file_key = uuid::Uuid::new_v4().simple().to_string();

    let padded_size = ((raw_size + 1 + 15) / 16) * 16;
    let encrypted = aes_ecb_encrypt(&raw_data, &aes_key_bytes);

    let (upload_full_url, upload_param) = get_upload_url(
        client,
        base_url,
        auth_headers,
        &file_key,
        type_info.upload_type,
        to_user_id,
        raw_size,
        &raw_md5,
        padded_size,
        &aes_key_hex,
        base_info,
    )
    .await?;

    let download_param = upload_to_cdn(
        client,
        &upload_full_url,
        &upload_param,
        &file_key,
        &encrypted,
    )
    .await?;

    let msg_body = build_media_message_body(
        to_user_id,
        context_token,
        &type_info,
        &download_param,
        &aes_key_hex,
        padded_size,
        raw_size,
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        base_info,
    );

    let resp = client
        .post(format!("{}/ilink/bot/sendmessage", base_url))
        .headers(auth_headers.clone())
        .json(&msg_body)
        .send()
        .await
        .map_err(|e| format!("sendmessage 请求失败: {e}"))?;

    let data: Value = resp.json().await.map_err(|e| format!("解析 sendmessage 响应失败: {e}"))?;
    let errcode = data.get("errcode").and_then(|v| v.as_i64()).unwrap_or(0);
    if errcode != 0 {
        return Err(format!(
            "sendmessage 失败: errcode={}, {}",
            errcode,
            data.get("errmsg").and_then(|v| v.as_str()).unwrap_or("")
        ));
    }

    Ok(())
}
