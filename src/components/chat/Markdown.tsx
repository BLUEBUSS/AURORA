import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import { useWorkspace } from "../../state";
import { useStreamingMarkdown } from "../../hooks";
import { parseCitationUrl, transformCitationMarkdown, ProvenanceReference } from "../provenance";
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const sessionKey = useWorkspace((s) => s.currentSessionId) || "";
  const content = useStreamingMarkdown(text, streaming);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => {
            const reference = parseCitationUrl(href);
            return reference ? (
              <ProvenanceReference reference={reference} sessionKey={sessionKey} />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {transformCitationMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
});
