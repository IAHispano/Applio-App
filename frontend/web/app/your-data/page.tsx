import { readFileSync } from "node:fs";
import path from "node:path";
import { ECOSYSTEM } from "@/lib/ecosystem";

const repositoryFiles = `${ECOSYSTEM.projects.desktop.repository}/blob/main/`;

function inline(text: string) {
  return text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/).map((part) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const url = new URL(link[2], repositoryFiles);
      return url.protocol === "https:" ? (
        <a
          key={part}
          href={url.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {link[1]}
        </a>
      ) : (
        link[1]
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={part}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={part}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function tableRow(line: string) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

export default function YourDataPage() {
  // Render the checked-in guide during the static export so it is readable offline.
  const document = readFileSync(path.resolve(process.cwd(), "../../YOUR_DATA.md"), "utf8");
  return (
    <article
      lang="en"
      className="w-full max-w-4xl mx-auto grid gap-5 pb-4 leading-relaxed [overflow-wrap:anywhere]"
    >
      {document
        .trim()
        .split(/\r?\n\s*\r?\n/)
        .map((block) => {
          const lines = block.split(/\r?\n/);
          if (block.startsWith("# ")) {
            return (
              <h1 key={block} className="title m-0 text-[26px] sm:text-[32px]">
                {inline(block.slice(2))}
              </h1>
            );
          }
          if (block.startsWith("## ")) {
            return (
              <h2 key={block} className="title text-xl mb-0 mt-3">
                {inline(block.slice(3))}
              </h2>
            );
          }
          if (block.startsWith("|")) {
            return (
              <table
                key={block}
                className="w-full table-fixed border-collapse text-sm border border-[var(--border)]"
              >
                <thead className="bg-[var(--surface)]">
                  <tr>
                    {tableRow(lines[0]).map((cell) => (
                      <th key={cell} scope="col" className="first:w-[32%] text-start p-2 sm:p-3">
                        {inline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.slice(2).map((line) => (
                    <tr key={line} className="border-t border-[var(--border)] align-top">
                      {tableRow(line).map((cell, k) =>
                        k === 0 ? (
                          <th key={cell} scope="row" className="font-medium text-start p-2 sm:p-3">
                            {inline(cell)}
                          </th>
                        ) : (
                          <td key={cell} className="p-2 sm:p-3">
                            {inline(cell)}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          if (/^\d+\. /.test(block)) {
            return (
              <ol key={block} className="list-decimal m-0 ps-6 space-y-2">
                {block.split(/\r?\n(?=\d+\. )/).map((item) => (
                  <li key={item}>{inline(item.replace(/^\d+\. /, "").replace(/\r?\n\s*/g, " "))}</li>
                ))}
              </ol>
            );
          }
          return (
            <p key={block} className="m-0">
              {inline(lines.join(" "))}
            </p>
          );
        })}
    </article>
  );
}
