//! 快速排版的位置計算。只處理矩形，所有筆記類型都適用，也不會改變大小。

use serde::Deserialize;

const GRID_GAP: f64 = 24.0;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Arrangement {
    AlignLeft,
    AlignCenterX,
    AlignRight,
    AlignTop,
    AlignCenterY,
    AlignBottom,
    DistributeX,
    DistributeY,
    Grid,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 回傳每個矩形的新位置，順序與輸入相同。
pub fn arrange(frames: &[Frame], arrangement: Arrangement) -> Vec<(f64, f64)> {
    if frames.is_empty() {
        return Vec::new();
    }
    let left = frames.iter().map(|f| f.x).fold(f64::INFINITY, f64::min);
    let top = frames.iter().map(|f| f.y).fold(f64::INFINITY, f64::min);
    let right = frames.iter().map(|f| f.x + f.w).fold(f64::NEG_INFINITY, f64::max);
    let bottom = frames.iter().map(|f| f.y + f.h).fold(f64::NEG_INFINITY, f64::max);
    let center_x = (left + right) / 2.0;
    let center_y = (top + bottom) / 2.0;
    let each = |place: &dyn Fn(&Frame) -> (f64, f64)| frames.iter().map(place).collect();

    match arrangement {
        Arrangement::AlignLeft => each(&|f| (left, f.y)),
        Arrangement::AlignCenterX => each(&|f| (center_x - f.w / 2.0, f.y)),
        Arrangement::AlignRight => each(&|f| (right - f.w, f.y)),
        Arrangement::AlignTop => each(&|f| (f.x, top)),
        Arrangement::AlignCenterY => each(&|f| (f.x, center_y - f.h / 2.0)),
        Arrangement::AlignBottom => each(&|f| (f.x, bottom - f.h)),
        Arrangement::DistributeX => {
            let starts: Vec<(f64, f64)> = frames.iter().map(|f| (f.x, f.w)).collect();
            let xs = distribute(&starts);
            frames.iter().zip(xs).map(|(f, x)| (x, f.y)).collect()
        }
        Arrangement::DistributeY => {
            let starts: Vec<(f64, f64)> = frames.iter().map(|f| (f.y, f.h)).collect();
            let ys = distribute(&starts);
            frames.iter().zip(ys).map(|(f, y)| (f.x, y)).collect()
        }
        Arrangement::Grid => grid(frames, left, top),
    }
}

/// 頭尾不動，讓中間的間距全部相等。`items` 是每個物件的起點與長度。
fn distribute(items: &[(f64, f64)]) -> Vec<f64> {
    let mut result: Vec<f64> = items.iter().map(|item| item.0).collect();
    if items.len() < 3 {
        return result;
    }
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by(|&a, &b| items[a].0.total_cmp(&items[b].0));

    let first = items[order[0]];
    let last = items[order[items.len() - 1]];
    let lengths: f64 = items.iter().map(|item| item.1).sum();
    let gap = (last.0 + last.1 - first.0 - lengths) / (items.len() - 1) as f64;

    let mut cursor = first.0;
    for index in order {
        result[index] = cursor;
        cursor += items[index].1 + gap;
    }
    result
}

/// 排成接近正方形的格狀，從原本範圍的左上角開始，並依閱讀順序保留大致的位置關係。
fn grid(frames: &[Frame], left: f64, top: f64) -> Vec<(f64, f64)> {
    let columns = (frames.len() as f64).sqrt().ceil() as usize;
    let mut by_height: Vec<usize> = (0..frames.len()).collect();
    by_height.sort_by(|&a, &b| frames[a].y.total_cmp(&frames[b].y));

    let mut column_widths = vec![0.0_f64; columns];
    let mut rows: Vec<Vec<usize>> = Vec::new();
    for chunk in by_height.chunks(columns) {
        let mut row = chunk.to_vec();
        row.sort_by(|&a, &b| frames[a].x.total_cmp(&frames[b].x));
        for (column, &index) in row.iter().enumerate() {
            column_widths[column] = column_widths[column].max(frames[index].w);
        }
        rows.push(row);
    }

    let mut result = vec![(0.0, 0.0); frames.len()];
    let mut y = top;
    for row in rows {
        let mut x = left;
        let mut row_height = 0.0_f64;
        for (column, index) in row.into_iter().enumerate() {
            result[index] = (x, y);
            x += column_widths[column] + GRID_GAP;
            row_height = row_height.max(frames[index].h);
        }
        y += row_height + GRID_GAP;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(x: f64, y: f64, w: f64, h: f64) -> Frame {
        Frame { x, y, w, h }
    }

    fn sample() -> Vec<Frame> {
        vec![frame(10.0, 40.0, 100.0, 50.0), frame(50.0, 0.0, 200.0, 100.0)]
    }

    #[test]
    fn aligns_to_the_edges_of_the_selection() {
        let frames = sample();
        assert_eq!(arrange(&frames, Arrangement::AlignLeft), [(10.0, 40.0), (10.0, 0.0)]);
        assert_eq!(arrange(&frames, Arrangement::AlignRight), [(150.0, 40.0), (50.0, 0.0)]);
        assert_eq!(arrange(&frames, Arrangement::AlignTop), [(10.0, 0.0), (50.0, 0.0)]);
        assert_eq!(arrange(&frames, Arrangement::AlignBottom), [(10.0, 50.0), (50.0, 0.0)]);
    }

    #[test]
    fn aligns_to_the_center_of_the_selection() {
        let frames = sample();
        assert_eq!(arrange(&frames, Arrangement::AlignCenterX), [(80.0, 40.0), (30.0, 0.0)]);
        assert_eq!(arrange(&frames, Arrangement::AlignCenterY), [(10.0, 25.0), (50.0, 0.0)]);
    }

    #[test]
    fn distributes_with_equal_gaps_and_fixed_ends() {
        let frames = [
            frame(300.0, 0.0, 100.0, 10.0),
            frame(0.0, 0.0, 100.0, 10.0),
            frame(120.0, 0.0, 40.0, 10.0),
        ];
        let result = arrange(&frames, Arrangement::DistributeX);
        assert_eq!(result[1].0, 0.0);
        assert_eq!(result[0].0, 300.0);
        assert_eq!(result[2].0, 180.0);
    }

    #[test]
    fn leaves_two_items_alone_when_distributing() {
        let frames = sample();
        assert_eq!(arrange(&frames, Arrangement::DistributeY), [(10.0, 40.0), (50.0, 0.0)]);
    }

    #[test]
    fn builds_a_grid_in_reading_order_without_overlap() {
        let frames = [
            frame(500.0, 500.0, 100.0, 50.0),
            frame(0.0, 0.0, 200.0, 50.0),
            frame(300.0, 0.0, 100.0, 80.0),
            frame(0.0, 500.0, 100.0, 50.0),
        ];
        let result = arrange(&frames, Arrangement::Grid);
        assert_eq!(result[1], (0.0, 0.0));
        assert_eq!(result[2], (224.0, 0.0));
        assert_eq!(result[3], (0.0, 104.0));
        assert_eq!(result[0], (224.0, 104.0));
    }

    #[test]
    fn handles_an_empty_selection() {
        assert!(arrange(&[], Arrangement::Grid).is_empty());
    }
}
