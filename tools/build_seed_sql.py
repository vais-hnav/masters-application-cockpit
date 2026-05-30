#!/usr/bin/env python3
"""Build a D1 seed file from the generated workbook data module."""

from __future__ import annotations

import json
import re
from pathlib import Path


DATA_PATH = Path("data/masters-data.js")
OUTPUT_PATH = Path("seed.sql")


def sql_text(value: object) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def json_text(value: object) -> str:
    return sql_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def load_data() -> dict:
    raw = DATA_PATH.read_text(encoding="utf-8")
    match = re.search(r"window\.MASTERS_DATA = (.*);\s*$", raw, re.S)
    if not match:
        raise ValueError(f"Could not parse {DATA_PATH}")
    return json.loads(match.group(1))


def insert(table: str, columns: list[str], values: list[object]) -> str:
    column_sql = ", ".join(columns)
    value_sql = ", ".join(values)
    return f"INSERT INTO {table} ({column_sql}) VALUES ({value_sql});"


def build_seed(data: dict) -> str:
    lines = [
        "DELETE FROM edit_history;",
        "DELETE FROM programs;",
        "DELETE FROM columns;",
        "DELETE FROM sections;",
        "DELETE FROM countries;",
        "DELETE FROM app_meta;",
        insert("app_meta", ["key", "value"], [sql_text("sourceFile"), sql_text(data.get("sourceFile", ""))]),
        insert("app_meta", ["key", "value"], [sql_text("generatedAt"), sql_text(data.get("generatedAt", ""))]),
        insert("app_meta", ["key", "value"], [sql_text("defaultCountry"), sql_text(data.get("defaultCountry", "Germany"))]),
    ]

    for index, section in enumerate(data.get("sections", [])):
        lines.append(
            insert(
                "sections",
                ["key", "label", "short_label", "tone", "description", "display_order"],
                [
                    sql_text(section["key"]),
                    sql_text(section["label"]),
                    sql_text(section.get("shortLabel", section["label"])),
                    sql_text(section["tone"]),
                    sql_text(section.get("description", "")),
                    str(index),
                ],
            )
        )

    for country_index, sheet in enumerate(data.get("sheets", [])):
        lines.append(insert("countries", ["name", "display_order"], [sql_text(sheet["name"]), str(country_index)]))

        for column_index, column in enumerate(sheet.get("columns", [])):
            lines.append(
                insert(
                    "columns",
                    ["country", "key", "label", "source_label", "letter", "index_position", "display_order"],
                    [
                        sql_text(sheet["name"]),
                        sql_text(column["key"]),
                        sql_text(column["label"]),
                        sql_text(column.get("sourceLabel", column["label"])),
                        sql_text(column["letter"]),
                        str(column["index"]),
                        str(column_index),
                    ],
                )
            )

        for row in sheet.get("rows", []):
            lines.append(
                insert(
                    "programs",
                    [
                        "id",
                        "country",
                        "row_number",
                        "band_key",
                        "fields_json",
                        "links_json",
                        "source_color",
                        "source_font_colors_json",
                        "source_colors_by_column_json",
                        "source_font_colors_by_column_json",
                        "updated_at",
                        "updated_by",
                    ],
                    [
                        sql_text(row["id"]),
                        sql_text(row["country"]),
                        str(row["rowNumber"]),
                        sql_text(row["sourceBand"]["key"]),
                        json_text(row.get("fields", {})),
                        json_text(row.get("links", [])),
                        sql_text(row.get("sourceColor")),
                        json_text(row.get("sourceFontColors", [])),
                        json_text(row.get("sourceColorsByColumn", {})),
                        json_text(row.get("sourceFontColorsByColumn", {})),
                        sql_text(data.get("generatedAt", "")),
                        sql_text("workbook-import"),
                    ],
                )
            )

    return "\n".join(lines) + "\n"


def main() -> None:
    data = load_data()
    sql = build_seed(data)
    OUTPUT_PATH.write_text(sql, encoding="utf-8")
    row_count = sum(len(sheet.get("rows", [])) for sheet in data.get("sheets", []))
    print(f"Wrote {OUTPUT_PATH} for {row_count} programs.")


if __name__ == "__main__":
    main()
