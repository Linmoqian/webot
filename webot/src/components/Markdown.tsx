import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { transformMarkdownUrl, resolveImageSrc, preprocessMediaMarkers, preprocessLocalImageLines } from "../utils/image";
import type { Message } from "../types";

export function renderMarkdown(content: string, mediaDir = "") {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeHighlight, rehypeKatex]}
      urlTransform={(url) => transformMarkdownUrl(url, mediaDir)}
      components={{
        img: ({ src, alt, ...props }) => (
          <img
            {...props}
            src={resolveImageSrc(src, mediaDir)}
            alt={alt || ""}
            loading="lazy"
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function renderMessageContent(msg: Message, mediaDir: string) {
  const contentWithMedia = msg.role === "agent" && mediaDir
    ? preprocessMediaMarkers(msg.content, mediaDir)
    : msg.content;
  const content = preprocessLocalImageLines(contentWithMedia, mediaDir);

  return renderMarkdown(content, mediaDir);
}
