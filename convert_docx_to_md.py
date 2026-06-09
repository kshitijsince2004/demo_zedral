"""Convert all .docx files in the doc/ folder to Markdown.

Handles headings, paragraphs, bullet/numbered lists, tables and basic
inline formatting (bold/italic). Uses only python-docx which is already
available in this environment.
"""
import os
import re

from docx import Document
from docx.document import Document as _Document
from docx.oxml.ns import qn
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph

DOC_DIR = "doc"


def iter_block_items(parent):
    """Yield paragraphs and tables in document order."""
    if isinstance(parent, _Document):
        parent_elm = parent.element.body
    elif isinstance(parent, _Cell):
        parent_elm = parent._tc
    else:
        parent_elm = parent._element

    for child in parent_elm.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)


def runs_to_md(paragraph):
    """Convert a paragraph's runs to markdown text with bold/italic."""
    parts = []
    for run in paragraph.runs:
        text = run.text
        if not text:
            continue
        # Escape markdown-significant chars minimally
        text = text.replace("\\", "\\\\")
        if run.bold and run.italic:
            text = f"***{text}***"
        elif run.bold:
            text = f"**{text}**"
        elif run.italic:
            text = f"*{text}*"
        parts.append(text)
    result = "".join(parts).strip()
    if not result:
        result = paragraph.text.strip()
    return result


def style_to_heading(style_name):
    """Map a docx style name to a markdown heading prefix, or None."""
    if not style_name:
        return None
    m = re.match(r"Heading (\d+)", style_name, re.IGNORECASE)
    if m:
        level = min(int(m.group(1)), 6)
        return "#" * level
    if style_name.lower() == "title":
        return "#"
    if style_name.lower() == "subtitle":
        return "##"
    return None


def is_list_paragraph(paragraph):
    """Return ('bullet'|'number', level) if paragraph is a list item."""
    style_name = (paragraph.style.name or "") if paragraph.style else ""
    numpr = paragraph._p.find(qn("w:pPr"))
    has_num = False
    if numpr is not None and numpr.find(qn("w:numPr")) is not None:
        has_num = True
    lname = style_name.lower()
    if "list bullet" in lname or (has_num and "number" not in lname):
        return ("bullet", 0)
    if "list number" in lname or has_num:
        return ("number", 0)
    return (None, 0)


def table_to_md(table):
    rows = []
    for row in table.rows:
        cells = [" ".join(c.text.split()).replace("|", "\\|") for c in row.cells]
        rows.append(cells)
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    lines = []
    header = rows[0]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * ncol) + " |")
    for r in rows[1:]:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def convert(filepath):
    doc = Document(filepath)
    out_lines = []
    prev_blank = True

    for block in iter_block_items(doc):
        if isinstance(block, Table):
            out_lines.append("")
            out_lines.append(table_to_md(block))
            out_lines.append("")
            prev_blank = True
            continue

        para = block
        text = runs_to_md(para)
        if not text:
            if not prev_blank:
                out_lines.append("")
                prev_blank = True
            continue

        style_name = (para.style.name or "") if para.style else ""
        heading = style_to_heading(style_name)
        list_type, _ = is_list_paragraph(para)

        if heading:
            out_lines.append("")
            out_lines.append(f"{heading} {text}")
            out_lines.append("")
        elif list_type == "bullet":
            out_lines.append(f"- {text}")
        elif list_type == "number":
            out_lines.append(f"1. {text}")
        else:
            out_lines.append(text)
            out_lines.append("")
        prev_blank = out_lines[-1] == ""

    # Collapse 3+ blank lines into 1
    md = "\n".join(out_lines)
    md = re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"
    return md


def main():
    converted = []
    for filename in sorted(os.listdir(DOC_DIR)):
        if not filename.lower().endswith(".docx"):
            continue
        src = os.path.join(DOC_DIR, filename)
        dst = os.path.join(DOC_DIR, os.path.splitext(filename)[0] + ".md")
        try:
            md = convert(src)
            with open(dst, "w", encoding="utf-8") as f:
                f.write(md)
            converted.append(dst)
            print(f"OK  {filename} -> {os.path.basename(dst)}")
        except Exception as e:
            print(f"ERR {filename}: {e}")
    print(f"\nConverted {len(converted)} file(s).")


if __name__ == "__main__":
    main()
