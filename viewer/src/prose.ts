interface FormattingFrame {
  marker: "" | "*" | "**";
  fragments: string[];
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function markerRun(text: string, start: number, marker: string): number {
  let end = start;
  while (text[end] === marker) {
    end++;
  }
  return end - start;
}

function closingBacktick(text: string, start: number): number {
  let position = text.indexOf("`", start);
  while (position !== -1) {
    const length = markerRun(text, position, "`");
    if (length === 1) {
      return position;
    }
    position = text.indexOf("`", position + length);
  }
  return -1;
}

/**
 * Safe inline formatting for guide text and source-link labels. This deliberately
 * supports only single-backtick code, **strong**, *emphasis*, and their nesting.
 * Underscores, HTML, Markdown links, and unsupported/unmatched delimiters remain
 * text. Backslash escapes apply only to backslash, backtick, and asterisk, outside
 * code spans. Every source character is escaped before entering returned HTML.
 */
export function renderInline(text: string): string {
  const frames: FormattingFrame[] = [{ marker: "", fragments: [] }];
  let position = 0;

  function append(fragment: string): void {
    frames[frames.length - 1].fragments.push(fragment);
  }

  function closeFrame(): void {
    const frame = frames.pop()!;
    const tag = frame.marker === "**" ? "strong" : "em";
    append(`<${tag}>${frame.fragments.join("")}</${tag}>`);
  }

  while (position < text.length) {
    const character = text[position];
    if (character === "\\" && /[\\`*]/.test(text[position + 1] ?? "")) {
      append(escapeText(text[position + 1]));
      position += 2;
      continue;
    }

    if (character === "`") {
      const length = markerRun(text, position, "`");
      const close = length === 1 ? closingBacktick(text, position + 1) : -1;
      if (close !== -1) {
        append(`<code>${escapeText(text.slice(position + 1, close))}</code>`);
        position = close + 1;
      } else {
        append("`".repeat(length));
        position += length;
      }
      continue;
    }

    if (character === "*") {
      const length = markerRun(text, position, "*");
      const previous = text[position - 1];
      const next = text[position + length];
      const canClose = previous !== undefined && !/\s/.test(previous);
      const canOpen = next !== undefined && !/\s/.test(next);
      let remaining = length;

      // Closing the innermost span first lets *** close either * inside ** or
      // ** inside *, while keeping the generated tags properly nested.
      while (canClose && frames.length > 1) {
        const frame = frames[frames.length - 1];
        if (frame.marker.length > remaining) {
          break;
        }
        remaining -= frame.marker.length;
        closeFrame();
      }
      if (canOpen && remaining > 0 && remaining <= 3) {
        if (remaining >= 2) {
          frames.push({ marker: "**", fragments: [] });
          remaining -= 2;
        }
        if (remaining === 1) {
          frames.push({ marker: "*", fragments: [] });
          remaining--;
        }
      }
      append("*".repeat(remaining));
      position += length;
      continue;
    }

    append(escapeText(character));
    position++;
  }

  // An unfinished span is ordinary prose, not an unterminated HTML element.
  while (frames.length > 1) {
    const frame = frames.pop()!;
    append(frame.marker + frame.fragments.join(""));
  }
  return frames[0].fragments.join("");
}
