import os
from docx import Document

doc_dir = "doc"
output_file = "doc_summary.txt"

with open(output_file, "w", encoding="utf-8") as out:
    for filename in sorted(os.listdir(doc_dir)):
        if filename.endswith(".docx"):
            filepath = os.path.join(doc_dir, filename)
            out.write(f"--- {filename} ---\n")
            try:
                doc = Document(filepath)
                for para in doc.paragraphs:
                    text = para.text.strip()
                    if text:
                        out.write(text + "\n")
            except Exception as e:
                out.write(f"Error reading {filename}: {e}\n")
            out.write("\n\n")

print(f"Extraction complete. Output written to {output_file}")
