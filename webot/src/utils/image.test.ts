import { describe, it, expect, vi } from "vitest";
import {
  getImageExt,
  isImagePath,
  isPassThroughUrl,
  isLocalPath,
  fileUrlToPath,
  resolveImageSrc,
  transformMarkdownUrl,
  preprocessMediaMarkers,
  preprocessLocalImageLines,
} from "./image";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

describe("getImageExt", () => {
  it("提取常见图片扩展名", () => {
    expect(getImageExt("photo.jpg")).toBe("jpg");
    expect(getImageExt("photo.png")).toBe("png");
  });

  it("忽略大小写", () => {
    expect(getImageExt("photo.JPEG")).toBe("jpeg");
    expect(getImageExt("photo.PnG")).toBe("png");
  });

  it("取最后一个点后的扩展名", () => {
    expect(getImageExt("archive.tar.gz")).toBe("gz");
  });

  it("去除查询参数后提取", () => {
    expect(getImageExt("https://example.com/img.png?w=200")).toBe("png");
  });

  it("无扩展名返回字符串本身", () => {
    expect(getImageExt("noext")).toBe("noext");
  });
});

describe("isImagePath", () => {
  it("图片扩展名返回 true", () => {
    expect(isImagePath("photo.jpg")).toBe(true);
    expect(isImagePath("icon.svg")).toBe(true);
    expect(isImagePath("pic.webp")).toBe(true);
  });

  it("非图片扩展名返回 false", () => {
    expect(isImagePath("doc.pdf")).toBe(false);
    expect(isImagePath("archive.zip")).toBe(false);
  });
});

describe("isPassThroughUrl", () => {
  it("https/http URL 返回 true", () => {
    expect(isPassThroughUrl("https://example.com")).toBe(true);
    expect(isPassThroughUrl("http://localhost:3000")).toBe(true);
  });

  it("asset/data/blob 协议返回 true", () => {
    expect(isPassThroughUrl("asset://localhost/file")).toBe(true);
    expect(isPassThroughUrl("data:image/png;base64,abc")).toBe(true);
    expect(isPassThroughUrl("blob:http://localhost/uuid")).toBe(true);
  });

  it("普通路径返回 false", () => {
    expect(isPassThroughUrl("/relative/path")).toBe(false);
    expect(isPassThroughUrl("file:///path")).toBe(false);
  });
});

describe("isLocalPath", () => {
  it("file:// 协议返回 true", () => {
    expect(isLocalPath("file:///C:/Users/test")).toBe(true);
  });

  it("Windows 盘符路径返回 true", () => {
    expect(isLocalPath("C:\\Users\\test")).toBe(true);
  });

  it("Unix 绝对路径返回 true", () => {
    expect(isLocalPath("/home/user/file")).toBe(true);
  });

  it("UNC 路径返回 true", () => {
    expect(isLocalPath("\\\\server\\share")).toBe(true);
  });

  it("远程 URL 返回 false", () => {
    expect(isLocalPath("https://example.com")).toBe(false);
  });
});

describe("fileUrlToPath", () => {
  it("Windows file:// URL 转路径", () => {
    expect(fileUrlToPath("file:///C:/Users/test.txt")).toBe("C:/Users/test.txt");
  });

  it("Unix file:// URL 转路径", () => {
    expect(fileUrlToPath("file:///home/user/doc.txt")).toBe("/home/user/doc.txt");
  });

  it("非 URL 退化处理", () => {
    expect(fileUrlToPath("not-a-url")).toBe("not-a-url");
  });
});

describe("resolveImageSrc", () => {
  it("undefined 输入返回 undefined", () => {
    expect(resolveImageSrc(undefined)).toBeUndefined();
  });

  it("https URL 直接返回", () => {
    expect(resolveImageSrc("https://example.com/img.png")).toBe(
      "https://example.com/img.png",
    );
  });

  it("file:// URL 调用 convertFileSrc", () => {
    expect(resolveImageSrc("file:///C:/photos/test.jpg")).toBe(
      "asset://localhost/C:/photos/test.jpg",
    );
  });

  it("Windows 本地路径调用 convertFileSrc", () => {
    expect(resolveImageSrc("C:\\Users\\photo.jpg")).toBe(
      "asset://localhost/C:\\Users\\photo.jpg",
    );
  });

  it("mediaDir 下的图片文件调用 convertFileSrc", () => {
    expect(resolveImageSrc("image.png", "/media")).toBe(
      "asset://localhost//media/image.png",
    );
  });

  it("非图片文件在 mediaDir 下不转换", () => {
    expect(resolveImageSrc("text.txt", "/media")).toBe("text.txt");
  });
});

describe("transformMarkdownUrl", () => {
  it("图片路径委托 resolveImageSrc", () => {
    expect(transformMarkdownUrl("photo.jpg", "/media")).toBe(
      "asset://localhost//media/photo.jpg",
    );
  });

  it("非图片非本地 URL 直接返回", () => {
    expect(transformMarkdownUrl("https://example.com/page")).toBe(
      "https://example.com/page",
    );
  });
});

describe("preprocessMediaMarkers", () => {
  it("图片 media 标记转为 markdown 图片语法", () => {
    const result = preprocessMediaMarkers("see [media: test.png]", "/tmp");
    expect(result).toContain("![test.png]");
    expect(result).toContain("asset://localhost//tmp/test.png");
  });

  it("非图片 media 标记转为普通链接", () => {
    const result = preprocessMediaMarkers("[media: doc.pdf]", "/tmp");
    expect(result).toContain("[doc.pdf]");
    expect(result).not.toContain("![doc.pdf]");
  });

  it("无 media 标记的文本不变", () => {
    expect(preprocessMediaMarkers("plain text", "/tmp")).toBe("plain text");
  });
});

describe("preprocessLocalImageLines", () => {
  it("本地图片路径行转为 markdown", () => {
    const result = preprocessLocalImageLines("/home/user/photo.jpg", "");
    expect(result).toContain("![/home/user/photo.jpg]");
  });

  it("以 ! 开头的行不处理", () => {
    const input = "![](already.md)";
    expect(preprocessLocalImageLines(input, "")).toBe(input);
  });

  it("普通文本行不变", () => {
    expect(preprocessLocalImageLines("hello world", "")).toBe("hello world");
  });

  it("mediaDir 下的图片文件名转为 markdown", () => {
    const result = preprocessLocalImageLines("photo.png", "/media");
    expect(result).toContain("![photo.png]");
    expect(result).toContain("asset://localhost//media/photo.png");
  });
});
