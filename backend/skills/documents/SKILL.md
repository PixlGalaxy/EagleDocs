---
name: Documents (PDF, Word, PowerPoint, Excel)
description: Use when you need to read, extract text or tables from, create, or edit PDF, Word (.docx), PowerPoint (.pptx) or Excel (.xlsx/.csv) files in the student's workspace.
---
# Documents: PDF, Word, PowerPoint, Excel

Work with files in the student's workspace using `code_run` (Python) plus `files_read`, `files_write`, `files_list`, `files_search`, `files_move`. Available libraries: pymupdf (`fitz`), pypdf, python-docx, python-pptx, openpyxl, pandas, numpy, matplotlib, reportlab, requests. There is no OCR engine, LibreOffice or internet guarantee in the sandbox: say so when a task needs them.

## General rules
- Never overwrite the student's original. Write results to a new file with a clear name, and tell the student the path.
- Verify output by reopening it and checking page/slide/row counts and key text before saying it is done.
- Keep provenance (file, page/sheet) when extracting facts, so answers can be cited.
- Large files: process page by page or sheet by sheet and print only summaries; do not dump whole documents into the chat.
- For a URL to a PDF or page use `web_fetch` or `web_download` first, then read the downloaded file.
- Check `files_usage` before producing many or large files.

## PDF
Read text with layout order and page numbers:
```python
import fitz
doc = fitz.open("file.pdf")
print(len(doc), "pages")
for i, page in enumerate(doc, 1):
    text = page.get_text()
    print(f"--- page {i} ({len(text)} chars) ---")
    print(text[:1500])
```
- Pages with almost no text are scans (images). There is no OCR here: tell the student, offer `browser_screenshot`/image-based reading only if feasible, or ask for a text version. Do not make up content.
- Tables: `page.find_tables()` (pymupdf) then `.extract()`, or pandas for the result.
- Images: `page.get_images()` and `doc.extract_image(xref)`.
- Merge/split/rotate/metadata with pypdf:
```python
from pypdf import PdfReader, PdfWriter
w = PdfWriter()
for f in ["a.pdf", "b.pdf"]:
    for p in PdfReader(f).pages: w.add_page(p)
w.write(open("merged.pdf", "wb"))
```
- Create PDFs with reportlab (`SimpleDocTemplate`, `Paragraph`, `Table`, `Spacer`) or from matplotlib (`plt.savefig("x.pdf")`). Use `Paragraph` for wrapped text; never put subscripts/superscripts as raw unicode in the default font.
- Form filling: pypdf `reader.get_fields()` and `writer.update_page_form_field_values(...)`. Show the student the values before saving.

## Word (.docx)
```python
from docx import Document
d = Document("in.docx")
for p in d.paragraphs: print(p.style.name, "|", p.text)
for t in d.tables:
    for row in t.rows: print([c.text for c in row.cells])
```
Create:
```python
from docx import Document
from docx.shared import Pt, Inches
d = Document()
d.add_heading("Title", 0)
p = d.add_paragraph("Body text"); p.runs[0].font.size = Pt(12)
d.add_paragraph("Item", style="List Bullet")
t = d.add_table(rows=1, cols=2, style="Table Grid")
d.add_picture("chart.png", width=Inches(5))
d.save("out.docx")
```
- Edit by changing run text so formatting survives; headers/footers are in `d.sections[0].header`.
- Page margins, line spacing, fonts: `d.sections[0].left_margin`, `p.paragraph_format.line_spacing`, `d.styles["Normal"].font`. Follow citation style requirements (APA/MLA) when the assignment states one.
- python-docx cannot accept tracked changes or render to PDF. For a PDF copy build it with reportlab separately and say it is a re-typeset version.

## PowerPoint (.pptx)
```python
from pptx import Presentation
prs = Presentation("in.pptx")
for i, s in enumerate(prs.slides, 1):
    print(i, [sh.text_frame.text for sh in s.shapes if sh.has_text_frame])
    if s.has_notes_slide: print("notes:", s.notes_slide.notes_text_frame.text)
```
Create with `Presentation()`, `slide_layouts[1]` (title and content), `shapes.add_picture`, `shapes.add_table`, and `notes_slide.notes_text_frame.text`. See `presentation-assignments` for the full workflow.

## Excel / CSV
```python
import pandas as pd
xl = pd.ExcelFile("in.xlsx")
for name in xl.sheet_names:
    df = xl.parse(name); print(name, df.shape); print(df.head())
```
- Write with `df.to_excel("out.xlsx", index=False)`, then reopen with openpyxl to format (bold header, column widths, number formats, freeze panes).
- Use real formulas when the student wants a working sheet: `ws["D2"] = "=B2*C2"`. openpyxl does not calculate them, so compute checks in pandas and say the formulas will calculate when opened in Excel.
- `openpyxl.load_workbook(path, data_only=True)` reads cached values; they are empty for files never opened in Excel.
- Charts: build with matplotlib and insert the PNG, or use `openpyxl.chart`.

## Scanned or image-only material
If extraction returns no text, report which pages are image-only and how many have text. Offer: the student provides a text version, you work from the readable pages only, or (for a few pages) view screenshots of them. Be explicit about what was and was not read.
