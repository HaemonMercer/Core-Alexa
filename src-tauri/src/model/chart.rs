//! 圖表：獨立的筆記類型，資料來自試算表的一段範圍，每次讀取時重算，所以永遠跟著來源。
//! 設定放在 `context`：`kind`、`seriesBy`、`source`（範圍的 JSON）。繪製在前端，版面是純函式。

use super::types::{CellRange, CellView, ChartData, ChartSeries, CreatedChart, NoteType, RangeView};
use super::Alexa;

const KINDS: [&str; 7] = ["line", "bar", "pie", "scatter", "area", "histogram", "radar"];
const BY_ROWS: &str = "rows";

fn is_number(cell: &CellView) -> bool {
    cell.number.is_some()
}

fn is_label(cell: &CellView) -> bool {
    !is_number(cell) && !cell.display.is_empty()
}

/// 第一列有文字就是系列名稱，第一欄有文字就是類別。空白不算，資料還沒填完時版面不會跳。
fn series_of(view: &RangeView, by_rows: bool) -> (Vec<String>, Vec<ChartSeries>) {
    let height = view.rows.len();
    let width = view.rows.first().map_or(0, Vec::len);
    let at = |line: usize, cross: usize| if by_rows { &view.rows[cross][line] } else { &view.rows[line][cross] };
    let (lines, crosses) = if by_rows { (width, height) } else { (height, width) };

    let has_names = lines > 1 && (0..crosses).any(|cross| is_label(at(0, cross)));
    let first_line = usize::from(has_names);
    let has_labels = crosses > 1 && (first_line..lines).any(|line| is_label(at(line, 0)));
    let first_cross = usize::from(has_labels);

    let labels = (first_line..lines)
        .map(|line| if has_labels { at(line, 0).display.clone() } else { (line - first_line + 1).to_string() })
        .collect();
    let series = (first_cross..crosses)
        .map(|cross| ChartSeries {
            name: if has_names { at(0, cross).display.clone() } else { format!("數列 {}", cross - first_cross + 1) },
            values: (first_line..lines).map(|line| at(line, cross).number).collect(),
        })
        .collect();
    (labels, series)
}

impl Alexa {
    pub(super) fn chart_source(&self, note_id: &str) -> Option<CellRange> {
        serde_json::from_str(&self.context_string(note_id, "source")?).ok()
    }

    /// 從試算表選取的範圍建立圖表，同時放到那個分頁上。
    pub fn create_chart(&mut self, source: CellRange, tab_id: &str, kind: &str) -> Result<CreatedChart, String> {
        if !KINDS.contains(&kind) {
            return Err(format!("unknown chart kind: {kind}"));
        }
        self.check_type(&source.note_id, NoteType::Sheet)?;
        let view = self.cell_range(&source)?;
        if let Some(error) = view.error {
            return Err(error);
        }
        let chart_id = self.new_note(NoteType::Chart)?;
        let json = serde_json::to_string(&source).map_err(|e| e.to_string())?;
        let name = format!("{} 圖表", view.table_name);
        self.set_context(&chart_id, &[("kind", kind.to_string()), ("source", json), ("name", name)])?;
        self.add_sheet_object(&source.note_id, tab_id, &chart_id, &source.table_id)?;
        Ok(CreatedChart {
            note: self.note(&chart_id)?.ok_or("created chart is missing")?,
            sheet: self.sheet(&source.note_id)?,
        })
    }

    pub fn chart(&mut self, note_id: &str) -> Result<ChartData, String> {
        self.check_type(note_id, NoteType::Chart)?;
        self.ensure_note(note_id)?;
        let kind = self.context_string(note_id, "kind").unwrap_or_else(|| KINDS[0].to_string());
        let by = self.context_string(note_id, "seriesBy");
        let title = self.note_name(note_id);
        let failed = |error: String, kind: String, title: String| ChartData {
            kind,
            title,
            series_by: "cols".to_string(),
            labels: Vec::new(),
            series: Vec::new(),
            error: Some(error),
        };
        let Some(source) = self.chart_source(note_id) else {
            return Ok(failed("圖表沒有資料來源".to_string(), kind, title));
        };
        let view = self.cell_range(&source)?;
        if let Some(error) = view.error.clone() {
            return Ok(failed(error, kind, title));
        }
        let by_rows = by.as_deref() == Some(BY_ROWS);
        let (labels, series) = series_of(&view, by_rows);
        Ok(ChartData {
            kind,
            title,
            series_by: if by_rows { BY_ROWS } else { "cols" }.to_string(),
            labels,
            series,
            error: None,
        })
    }

    pub fn set_chart(&mut self, note_id: &str, kind: Option<&str>, series_by: Option<&str>) -> Result<ChartData, String> {
        self.check_type(note_id, NoteType::Chart)?;
        self.ensure_note(note_id)?;
        if kind.is_some_and(|kind| !KINDS.contains(&kind)) {
            return Err("unknown chart kind".to_string());
        }
        let mut fields = Vec::new();
        if let Some(kind) = kind {
            fields.push(("kind", kind.to_string()));
        }
        if let Some(by) = series_by {
            fields.push(("seriesBy", by.to_string()));
        }
        self.set_context(note_id, &fields)?;
        self.chart(note_id)
    }
}
