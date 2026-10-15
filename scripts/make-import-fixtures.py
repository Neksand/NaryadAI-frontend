"""Generate minimal .xlsx fixtures for catalog-import e2e (stdlib only).

System python3 has no openpyxl, so valid minimal xlsx files are assembled
by hand as a zip of XML parts (inline strings, no sharedStrings.xml).
Readability is verified with the backend venv's openpyxl
(/Users/neksand/Desktop/NaryadAI-FastAPI-Backend/.venv) which is the same
reader the import endpoint uses.

Fixtures:
  e2e/fixtures/import-ok.xlsx  - equipment, 2 valid rows (e2e-* inventory_no)
  e2e/fixtures/import-bad.xlsx - equipment, row 3 has empty name + bad criticality
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import xml.sax.saxutils as sax
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / "e2e" / "fixtures"

# Placeholder only: CLI callers must pass an area ID from their live database.
AREA_ID = ""


def _col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def make_xlsx(header: list[str], rows: list[list[object]]) -> bytes:
    sheet_rows: list[str] = []
    for ri, row in enumerate([header, *rows], start=1):
        cells = "".join(
            f'<c r="{_col(ci)}{ri}" t="inlineStr"><is><t>{sax.escape(str(v))}</t></is></c>'
            for ci, v in enumerate(row)
        )
        sheet_rows.append(f"<row r=\"{ri}\">{cells}</row>")
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(sheet_rows)}</sheetData></worksheet>"
    )
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxml-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>"
        ),
        "xl/worksheets/sheet1.xml": sheet,
        "xl/styles.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
            '<borders count="1"><border/></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
            "</styleSheet>"
        ),
    }
    import io

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in parts.items():
            zf.writestr(name, text.encode("utf-8"))
    return buf.getvalue()


HEADER = ["name", "inventory_no", "area_id", "type", "criticality"]

OK_ROWS = [
    ["E2E Pump A", "e2e-ok-1", AREA_ID, "pump", "A"],
    ["E2E Pump B", "e2e-ok-2", AREA_ID, "pump", "B"],
]

BAD_ROWS = [
    ["E2E Pump A", "e2e-bad-1", AREA_ID, "pump", "A"],
    ["", "e2e-bad-2", AREA_ID, "pump", "Z"],  # row 3: empty name + bad criticality
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--area-id', required=True)
    parser.add_argument('--stdout-fixture', choices=['import-ok.xlsx', 'import-bad.xlsx'])
    args = parser.parse_args()
    fixtures = {
        'import-ok.xlsx': [row[:2] + [args.area_id] + row[3:] for row in OK_ROWS],
        'import-bad.xlsx': [row[:2] + [args.area_id] + row[3:] for row in BAD_ROWS],
    }
    if args.stdout_fixture:
        sys.stdout.buffer.write(make_xlsx(HEADER, fixtures[args.stdout_fixture]))
        return
    FIX.mkdir(parents=True, exist_ok=True)
    (FIX / "import-ok.xlsx").write_bytes(make_xlsx(HEADER, fixtures['import-ok.xlsx']))
    (FIX / "import-bad.xlsx").write_bytes(make_xlsx(HEADER, fixtures['import-bad.xlsx']))
    print(f"wrote {FIX / 'import-ok.xlsx'} ({len(OK_ROWS)} rows)")
    print(f"wrote {FIX / 'import-bad.xlsx'} ({len(BAD_ROWS)} rows)")


if __name__ == "__main__":
    main()
