export type WorkbookCell = string | number | undefined | null;
export type WorkbookMetric = { label: string; value: string };
export type WorkbookTable = { title: string; columns: string[]; rows: WorkbookCell[][]; emptyMessage?: string };
export type WorkbookSection = { title: string; subtitle?: string; metrics?: WorkbookMetric[]; tables?: WorkbookTable[] };
export type WorkbookDocument = { title: string; subtitle: string; sections: WorkbookSection[] };

type StyledCell = { value: WorkbookCell; style: number };
type SheetModel = {
  name: string;
  rows: StyledCell[][];
  merges: string[];
  widths: number[];
};
type ZipFile = { name: string; data: Uint8Array };

const STYLE_DEFAULT = 0;
const STYLE_TITLE = 1;
const STYLE_SUBTITLE = 2;
const STYLE_METRIC_LABEL = 3;
const STYLE_METRIC_VALUE = 4;
const STYLE_TABLE_HEADER = 5;
const STYLE_TEXT = 6;
const STYLE_CURRENCY = 7;
const STYLE_NUMBER = 8;
const STYLE_EMPTY = 9;
const MAX_SHEET_NAME_LENGTH = 31;

export function buildXlsxWorkbook(document: WorkbookDocument): Uint8Array {
  const generatedAt = formatGeneratedAt(new Date());
  const sheets = buildSheetModels(document, generatedAt);
  const files: ZipFile[] = [
    textFile("[Content_Types].xml", contentTypesXml(sheets.length)),
    textFile("_rels/.rels", rootRelsXml()),
    textFile("docProps/app.xml", appPropertiesXml(sheets)),
    textFile("docProps/core.xml", corePropertiesXml(document.title, generatedAt)),
    textFile("xl/workbook.xml", workbookXml(sheets)),
    textFile("xl/_rels/workbook.xml.rels", workbookRelsXml(sheets.length)),
    textFile("xl/styles.xml", stylesXml()),
    ...sheets.map((sheet, index) => textFile(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)))
  ];
  return zipFiles(files);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index++];
    const second = index < bytes.length ? bytes[index++] : Number.NaN;
    const third = index < bytes.length ? bytes[index++] : Number.NaN;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (Number.isNaN(second) ? 0 : second >> 4)];
    output += Number.isNaN(second) ? "=" : alphabet[((second & 15) << 2) | (Number.isNaN(third) ? 0 : third >> 6)];
    output += Number.isNaN(third) ? "=" : alphabet[third & 63];
  }
  return output;
}

function buildSheetModels(document: WorkbookDocument, generatedAt: string): SheetModel[] {
  const sections = document.sections.length
    ? document.sections
    : [{ title: "Report", tables: [{ title: "No data", columns: ["Message"], rows: [["No report data available."]] }] }];
  const names = uniqueSheetNames(sections.map((section) => section.title));
  return sections.map((section, index) => sectionToSheet(document, section, names[index], generatedAt));
}

function sectionToSheet(document: WorkbookDocument, section: WorkbookSection, name: string, generatedAt: string): SheetModel {
  const maxColumns = Math.max(2, ...(section.tables || []).map((table) => table.columns.length));
  const rows: StyledCell[][] = [];
  const merges: string[] = [];
  const widths = estimateWidths(section, maxColumns);

  const addMergedRow = (value: WorkbookCell, style: number) => {
    rows.push([{ value, style }]);
    merges.push(`A${rows.length}:${columnName(maxColumns)}${rows.length}`);
  };
  const addBlankRow = () => rows.push([]);

  addMergedRow(document.title, STYLE_TITLE);
  addMergedRow(`Period: ${document.subtitle}`, STYLE_SUBTITLE);
  addMergedRow(`Generated: ${generatedAt}`, STYLE_SUBTITLE);
  addBlankRow();
  addMergedRow(section.title, STYLE_TITLE);
  if (section.subtitle) addMergedRow(section.subtitle, STYLE_SUBTITLE);

  if (section.metrics?.length) {
    addBlankRow();
    rows.push([
      { value: "Metric", style: STYLE_TABLE_HEADER },
      { value: "Value", style: STYLE_TABLE_HEADER }
    ]);
    section.metrics.forEach((metric) => {
      rows.push([
        { value: metric.label, style: STYLE_METRIC_LABEL },
        { value: metric.value, style: STYLE_METRIC_VALUE }
      ]);
    });
  }

  (section.tables || []).forEach((table) => {
    addBlankRow();
    addMergedRow(table.title, STYLE_SUBTITLE);
    rows.push(table.columns.map((column) => ({ value: column, style: STYLE_TABLE_HEADER })));
    if (table.rows.length) {
      table.rows.forEach((row) => rows.push(row.map((value) => ({ value, style: STYLE_TEXT }))));
    } else {
      rows.push([{ value: table.emptyMessage || "No records available.", style: STYLE_EMPTY }]);
      merges.push(`A${rows.length}:${columnName(maxColumns)}${rows.length}`);
    }
  });

  if (!section.metrics?.length && !section.tables?.length) {
    addBlankRow();
    addMergedRow("No records available.", STYLE_EMPTY);
  }

  return { name, rows, merges, widths };
}

function estimateWidths(section: WorkbookSection, maxColumns: number) {
  const widths = Array.from({ length: maxColumns }, () => 14);
  const add = (columnIndex: number, value: WorkbookCell) => {
    widths[columnIndex] = Math.min(42, Math.max(widths[columnIndex] || 14, String(value ?? "").length + 3));
  };
  (section.metrics || []).forEach((metric) => {
    add(0, metric.label);
    add(1, metric.value);
  });
  (section.tables || []).forEach((table) => {
    table.columns.forEach((column, index) => add(index, column));
    table.rows.slice(0, 250).forEach((row) => row.forEach((cell, index) => add(index, cell)));
  });
  return widths.map((width) => Math.max(10, width));
}

function worksheetXml(sheet: SheetModel) {
  const maxColumns = Math.max(1, sheet.widths.length);
  const maxRows = Math.max(1, sheet.rows.length);
  return xmlDocument(`\
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(maxColumns)}${maxRows}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    ${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}
  </cols>
  <sheetData>
    ${sheet.rows.map((row, rowIndex) => rowXml(row, rowIndex + 1)).join("")}
  </sheetData>
  ${sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`);
}

function rowXml(row: StyledCell[], rowNumber: number) {
  if (!row.length) return `<row r="${rowNumber}"/>`;
  return `<row r="${rowNumber}">${row.map((cell, index) => cellXml(cell, rowNumber, index + 1)).join("")}</row>`;
}

function cellXml(cell: StyledCell, rowNumber: number, columnNumber: number) {
  const ref = `${columnName(columnNumber)}${rowNumber}`;
  const value = cell.value;
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}" s="${cell.style || STYLE_DEFAULT}"/>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${STYLE_NUMBER}"><v>${value}</v></c>`;
  }
  const moneyValue = moneyValueFromText(String(value));
  if (moneyValue !== null) {
    return `<c r="${ref}" s="${STYLE_CURRENCY}"><v>${moneyValue}</v></c>`;
  }
  return `<c r="${ref}" s="${cell.style || STYLE_TEXT}" t="inlineStr"><is><t>${escapeXmlText(value)}</t></is></c>`;
}

function moneyValueFromText(value: string) {
  const match = /^Rs\.\s*(-?[\d,]+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function contentTypesXml(sheetCount: number) {
  return xmlDocument(`\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`);
}

function rootRelsXml() {
  return xmlDocument(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
}

function workbookXml(sheets: SheetModel[]) {
  return xmlDocument(`\
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews>
  <sheets>
    ${sheets.map((sheet, index) => `<sheet name="${escapeXmlAttribute(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}
  </sheets>
</workbook>`);
}

function workbookRelsXml(sheetCount: number) {
  return xmlDocument(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function appPropertiesXml(sheets: SheetModel[]) {
  return xmlDocument(`\
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Autocare24 Mobile</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="${sheets.length}" baseType="lpstr">
      ${sheets.map((sheet) => `<vt:lpstr>${escapeXmlText(sheet.name)}</vt:lpstr>`).join("")}
    </vt:vector>
  </TitlesOfParts>
  <Company>Autocare24</Company>
</Properties>`);
}

function corePropertiesXml(title: string, generatedAt: string) {
  const iso = new Date().toISOString();
  return xmlDocument(`\
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXmlText(title)}</dc:title>
  <dc:creator>Autocare24 Mobile</dc:creator>
  <cp:lastModifiedBy>Autocare24 Mobile</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>
  <dc:description>Generated ${escapeXmlText(generatedAt)}</dc:description>
</cp:coreProperties>`);
}

function stylesXml() {
  return xmlDocument(`\
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="&quot;Rs.&quot; #,##0.00"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF302D45"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FF302D45"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF5A3FD5"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF5A3FD5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2EFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE3E1EE"/></left><right style="thin"><color rgb="FFE3E1EE"/></right><top style="thin"><color rgb="FFE3E1EE"/></top><bottom style="thin"><color rgb="FFE3E1EE"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`);
}

function uniqueSheetNames(titles: string[]) {
  const used = new Set<string>();
  return titles.map((title, index) => {
    const fallback = `Sheet ${index + 1}`;
    const base = sanitizeSheetName(title || fallback) || fallback;
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const suffixText = ` ${suffix}`;
      name = `${base.slice(0, MAX_SHEET_NAME_LENGTH - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function sanitizeSheetName(value: string) {
  return value
    .replace(/[\[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SHEET_NAME_LENGTH);
}

function columnName(columnNumber: number) {
  let column = columnNumber;
  let name = "";
  while (column > 0) {
    column -= 1;
    name = String.fromCharCode(65 + (column % 26)) + name;
    column = Math.floor(column / 26);
  }
  return name || "A";
}

function xmlDocument(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

function textFile(name: string, text: string): ZipFile {
  return { name, data: utf8Bytes(text) };
}

function zipFiles(files: ZipFile[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime(new Date());

  files.forEach((file) => {
    const nameBytes = utf8Bytes(file.name);
    const crc = crc32(file.data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0x0800);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, dosTime);
    writeUint16(localHeader, 12, dosDate);
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, file.data.length);
    writeUint32(localHeader, 22, file.data.length);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, file.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0x0800);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, dosTime);
    writeUint16(centralHeader, 14, dosDate);
    writeUint32(centralHeader, 16, crc);
    writeUint32(centralHeader, 20, file.data.length);
    writeUint32(centralHeader, 24, file.data.length);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, files.length);
  writeUint16(end, 10, files.length);
  writeUint32(end, 12, centralSize);
  writeUint32(end, 16, centralOffset);
  writeUint16(end, 20, 0);

  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Bytes(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function escapeXmlText(value: WorkbookCell) {
  return sanitizeXml(String(value ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeXml(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function formatGeneratedAt(date: Date) {
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
