#!/usr/bin/env python3
"""Extract Masters Planning.xlsx into a browser-friendly data module.

The environment for this project intentionally has no Node/npm dependency, so
this parser reads the XLSX package XML directly. It preserves row fill signals
as semantic planning bands for the web app.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from zipfile import ZipFile


WORKBOOK_PATH = Path("/Users/vaishnav/Downloads/Masters Planning.xlsx")
OUTPUT_PATH = Path("data/masters-data.js")

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def q(name: str) -> str:
    return f"{{{NS_MAIN}}}{name}"


def qr(name: str) -> str:
    return f"{{{NS_REL}}}{name}"


def text_of(element: ET.Element | None) -> str:
    return "" if element is None else "".join(element.itertext())


def column_number(column: str) -> int:
    total = 0
    for character in column:
        total = total * 26 + ord(character) - 64
    return total


def column_name(number: int) -> str:
    name = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        name = chr(65 + remainder) + name
    return name


def cell_position(reference: str) -> tuple[int, int]:
    match = re.match(r"([A-Z]+)(\d+)", reference)
    if not match:
        raise ValueError(f"Bad cell reference: {reference}")
    return column_number(match.group(1)), int(match.group(2))


def slugify(value: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", value.replace("Tuiton", "Tuition"))
    if not words:
        return "field"
    return words[0].lower() + "".join(word.capitalize() for word in words[1:])


def clean_label(value: str) -> str:
    replacements = {
        "Tuiton Fee(Euros per sem)": "Tuition Fee (EUR / sem)",
        "Comments / Rejection Reason": "Comments / Reason",
        "Application open": "Application Opens",
        "Uni-assist?": "Uni-assist",
    }
    return replacements.get(value, value)


def excel_date(serial: float) -> str:
    base = dt.datetime(1899, 12, 30)
    return (base + dt.timedelta(days=serial)).date().isoformat()


def format_value(raw_value: str, key: str) -> str:
    value = raw_value.strip()
    if not value:
        return ""

    if key in {"deadline", "dateApplied", "applicationOpen", "enrollmentDeadline"}:
        try:
            numeric = float(value)
            if 20000 <= numeric <= 70000:
                return excel_date(numeric)
        except ValueError:
            return value

    try:
        numeric = float(value)
    except ValueError:
        return value

    if numeric.is_integer():
        return str(int(numeric))
    return str(numeric)


ADMIT_SECTION = {
    "key": "admit",
    "label": "Admit received",
    "shortLabel": "Admit",
    "tone": "admit",
    "description": "Confirmed admits and positive outcomes.",
}

ACTION_SECTION = {
    "key": "action",
    "label": "Action needed",
    "shortLabel": "Action",
    "tone": "action",
    "description": "Rows that need a concrete next step.",
}

WAITING_SECTION = {
    "key": "waiting",
    "label": "Applied and waiting",
    "shortLabel": "Waiting",
    "tone": "waiting",
    "description": "Submitted applications waiting for decisions.",
}

REJECTED_SECTION = {
    "key": "rejected",
    "label": "Rejected",
    "shortLabel": "Rejected",
    "tone": "rejected",
    "description": "Negative outcomes and closed options.",
}

SKIPPED_SECTION = {
    "key": "skipped",
    "label": "Skipped",
    "shortLabel": "Skipped",
    "tone": "skipped",
    "description": "Rows not being pursued right now.",
}

SECTIONS = [ADMIT_SECTION, WAITING_SECTION, REJECTED_SECTION, SKIPPED_SECTION, ACTION_SECTION]
RED_FONT = "FFFF0000"
ADMIT_FILL = "FF00FF00"
WAITING_FILL = "FFD9EAD3"
ATTENTION_FILL = "FFFFFF00"


def has_rejected_font(red_font_indexes: set[int]) -> bool:
    return 3 in red_font_indexes or len({index for index in red_font_indexes if index <= 12}) >= 3


def section_from_source(
    source_color: str | None,
    red_font_indexes: set[int],
    applied_fill: str | None,
) -> dict[str, str]:
    if has_rejected_font(red_font_indexes):
        return dict(REJECTED_SECTION)
    if source_color == ADMIT_FILL:
        return dict(ADMIT_SECTION)
    if applied_fill == ATTENTION_FILL:
        return dict(ACTION_SECTION)
    if source_color == WAITING_FILL:
        return dict(WAITING_SECTION)
    return dict(SKIPPED_SECTION)


def is_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def load_relationships(zipped: ZipFile, sheet_path: str) -> dict[str, str]:
    folder, filename = sheet_path.rsplit("/", 1)
    rels_path = f"{folder}/_rels/{filename}.rels"
    if rels_path not in zipped.namelist():
        return {}
    root = ET.fromstring(zipped.read(rels_path))
    return {
        rel.attrib["Id"]: rel.attrib.get("Target", "")
        for rel in root.findall(f"{{{NS_PKG_REL}}}Relationship")
    }


def extract() -> dict:
    with ZipFile(WORKBOOK_PATH) as zipped:
        workbook = ET.fromstring(zipped.read("xl/workbook.xml"))
        workbook_rels = ET.fromstring(zipped.read("xl/_rels/workbook.xml.rels"))
        relationship_targets = {
            relationship.attrib["Id"]: relationship.attrib["Target"]
            for relationship in workbook_rels.findall(f"{{{NS_PKG_REL}}}Relationship")
        }

        shared_strings = []
        if "xl/sharedStrings.xml" in zipped.namelist():
            shared_root = ET.fromstring(zipped.read("xl/sharedStrings.xml"))
            shared_strings = [text_of(item) for item in shared_root.findall(q("si"))]

        styles = ET.fromstring(zipped.read("xl/styles.xml"))
        fills = []
        for fill in styles.find(q("fills")) or []:
            color = None
            pattern = fill.find(q("patternFill"))
            if pattern is not None:
                for color_name in ("fgColor", "bgColor"):
                    color_node = pattern.find(q(color_name))
                    if color_node is None:
                        continue
                    if "rgb" in color_node.attrib:
                        color = color_node.attrib["rgb"]
                    elif "theme" in color_node.attrib:
                        color = f"theme:{color_node.attrib['theme']}"
                    elif "indexed" in color_node.attrib:
                        color = f"indexed:{color_node.attrib['indexed']}"
                    if color:
                        break
            fills.append(color)

        xf_fill_ids = []
        fonts = []
        for font in styles.find(q("fonts")) or []:
            color_node = font.find(q("color"))
            color = None
            if color_node is not None:
                if "rgb" in color_node.attrib:
                    color = color_node.attrib["rgb"]
                elif "theme" in color_node.attrib:
                    color = f"theme:{color_node.attrib['theme']}"
                elif "indexed" in color_node.attrib:
                    color = f"indexed:{color_node.attrib['indexed']}"
            fonts.append(color)

        xf_font_ids = []
        for xf in styles.find(q("cellXfs")) or []:
            xf_fill_ids.append(int(xf.attrib.get("fillId", "0")))
            xf_font_ids.append(int(xf.attrib.get("fontId", "0")))

        sheets = []
        for sheet_node in workbook.find(q("sheets")) or []:
            raw_target = relationship_targets[sheet_node.attrib[qr("id")]]
            target = raw_target if raw_target.startswith("xl/") else f"xl/{raw_target}"
            sheets.append({"name": sheet_node.attrib["name"], "path": target})

        extracted_sheets = []

        for sheet in sheets:
            relationships = load_relationships(zipped, sheet["path"])
            root = ET.fromstring(zipped.read(sheet["path"]))

            hyperlinks = {}
            links_node = root.find(q("hyperlinks"))
            if links_node is not None:
                for link in links_node.findall(q("hyperlink")):
                    reference = link.attrib.get("ref")
                    relationship_id = link.attrib.get(qr("id"))
                    location = link.attrib.get("location")
                    if reference and relationship_id in relationships:
                        hyperlinks[reference] = relationships[relationship_id]
                    elif reference and location:
                        hyperlinks[reference] = location

            rows_by_number = {}
            colors_by_row = {}
            raw_colors_by_row = {}
            font_colors_by_row = {}
            raw_font_colors_by_row = {}

            for row in root.find(q("sheetData")) or []:
                row_number = int(row.attrib.get("r", "0"))
                row_cells = rows_by_number.setdefault(row_number, {})
                color_cells = colors_by_row.setdefault(row_number, {})
                raw_color_cells = raw_colors_by_row.setdefault(row_number, {})
                font_color_cells = font_colors_by_row.setdefault(row_number, {})
                raw_font_color_cells = raw_font_colors_by_row.setdefault(row_number, {})

                for cell in row.findall(q("c")):
                    reference = cell.attrib.get("r", "")
                    column, _ = cell_position(reference)
                    style_index = int(cell.attrib.get("s", "0"))
                    fill_color = None
                    font_color = None
                    if style_index < len(xf_fill_ids):
                        fill_id = xf_fill_ids[style_index]
                        if fill_id < len(fills):
                            fill_color = fills[fill_id]
                    if style_index < len(xf_font_ids):
                        font_id = xf_font_ids[style_index]
                        if font_id < len(fonts):
                            font_color = fonts[font_id]
                    if fill_color:
                        color_cells[column] = fill_color
                        raw_color_cells[column_name(column)] = fill_color
                    if font_color:
                        font_color_cells[column] = font_color
                        raw_font_color_cells[column_name(column)] = font_color

                    cell_type = cell.attrib.get("t")
                    value_node = cell.find(q("v"))
                    inline_node = cell.find(q("is"))
                    value = ""
                    if cell_type == "s" and value_node is not None:
                        value = shared_strings[int(value_node.text)]
                    elif cell_type == "inlineStr":
                        value = text_of(inline_node)
                    elif value_node is not None:
                        value = value_node.text or ""

                    if value:
                        row_cells[column] = value
                    if reference in hyperlinks and not value:
                        row_cells[column] = hyperlinks[reference]

            header_row = rows_by_number.get(1, {})
            max_meaningful_column = max((column for column, value in header_row.items() if value), default=0)
            column_defs = []
            seen_keys = Counter()
            for column in range(1, max_meaningful_column + 1):
                header = header_row.get(column, "").strip()
                if not header or header.startswith("Column "):
                    continue
                key = slugify(header)
                seen_keys[key] += 1
                if seen_keys[key] > 1:
                    key = f"{key}{seen_keys[key]}"
                column_defs.append(
                    {
                        "key": key,
                        "label": clean_label(header),
                        "sourceLabel": header,
                        "letter": column_name(column),
                        "index": column,
                    }
                )

            meaningful_indexes = {column["index"] for column in column_defs}
            rows = []

            for row_number in sorted(number for number in rows_by_number if number != 1):
                source_cells = rows_by_number[row_number]
                if not any(source_cells.get(index, "").strip() for index in meaningful_indexes):
                    continue

                color_counter = Counter(
                    color
                    for index, color in colors_by_row.get(row_number, {}).items()
                    if index in meaningful_indexes
                )
                source_color = color_counter.most_common(1)[0][0] if color_counter else None

                fields = {}
                for column in column_defs:
                    raw_value = source_cells.get(column["index"], "")
                    fields[column["key"]] = format_value(raw_value, column["key"])

                font_colors = {
                    color
                    for index, color in font_colors_by_row.get(row_number, {}).items()
                    if index in meaningful_indexes and color
                }
                red_font_indexes = {
                    index
                    for index, color in font_colors_by_row.get(row_number, {}).items()
                    if index in meaningful_indexes and color == RED_FONT
                }
                applied_column = next((column["index"] for column in column_defs if column["key"] == "applied"), None)
                applied_fill = colors_by_row.get(row_number, {}).get(applied_column)
                band = section_from_source(source_color, red_font_indexes, applied_fill)

                links = []
                for column in column_defs:
                    value = fields.get(column["key"], "")
                    if is_url(value):
                        links.append(
                            {
                                "field": column["key"],
                                "label": column["label"],
                                "url": value,
                            }
                        )

                row_id = f"{sheet['name'].lower().replace(' ', '-')}-{row_number}"
                rows.append(
                    {
                        "id": row_id,
                        "country": sheet["name"],
                        "rowNumber": row_number,
                        "sourceColor": source_color,
                        "sourceFontColors": sorted(font_colors),
                        "sourceBand": band,
                        "fields": fields,
                        "links": links,
                        "sourceColorsByColumn": raw_colors_by_row.get(row_number, {}),
                        "sourceFontColorsByColumn": raw_font_colors_by_row.get(row_number, {}),
                    }
                )

            extracted_sheets.append(
                {
                    "name": sheet["name"],
                    "columns": column_defs,
                    "rows": rows,
                }
            )

        return {
            "sourceFile": str(WORKBOOK_PATH),
            "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "defaultCountry": "Germany",
            "sections": SECTIONS,
            "sheets": extracted_sheets,
        }


def main() -> None:
    data = extract()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    OUTPUT_PATH.write_text(f"window.MASTERS_DATA = {payload};\n", encoding="utf-8")
    row_count = sum(len(sheet["rows"]) for sheet in data["sheets"])
    print(f"Wrote {OUTPUT_PATH} with {row_count} rows from {len(data['sheets'])} sheets.")


if __name__ == "__main__":
    main()
