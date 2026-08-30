import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock';

// rehype-highlight turns fenced code into a tree of React nodes (a <span>
// per highlighted token), not a plain string — react-markdown then hands us
// that node tree as `children`. We need the actual source text too (for the
// "Copy" button and to detect a real multi-line block vs. inline code), so
// this walks the tree and concatenates the text leaves. Never call
// String(children) directly on it — String() on an array of React elements
// produces "[object Object]" once per element, not the source text.
function getTextContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getTextContent(node.props.children);
  return '';
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
          code({ className, children, ...props }) {
            const text = getTextContent(children);
            const isBlock = className?.includes('language-') || text.includes('\n');
            if (!isBlock) {
              return (
                <code className="rounded bg-white/10 px-1 py-0.5 text-[0.85em]" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock className={className} code={text.replace(/\n$/, '')}>
                {children}
              </CodeBlock>
            );
          },
          table: ({ children, ...props }) => (
            <div className="scrollbar-thin my-3 overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
