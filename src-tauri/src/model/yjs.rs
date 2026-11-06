//! 讀寫 Y.Doc 裡的值會用到的小工具。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use yrs::{Any, GetString, Number, Out, Text, TextRef};

pub(super) fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

pub(super) fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub(super) fn any_number(value: &Any) -> Option<f64> {
    match value {
        Any::Number(Number::Float(number)) => Some(*number),
        Any::Number(Number::Int(number)) => Some(*number as f64),
        _ => None,
    }
}

pub(super) fn out_number(value: Option<Out>) -> f64 {
    match value {
        Some(Out::Any(any)) => any_number(&any).unwrap_or(0.0),
        _ => 0.0,
    }
}

pub(super) fn out_string(value: Option<Out>) -> Option<String> {
    match value {
        Some(Out::Any(Any::String(text))) => Some(text.to_string()),
        _ => None,
    }
}

pub(super) fn record(fields: Vec<(&str, Any)>) -> Any {
    let map: HashMap<String, Any> = fields
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();
    Any::Map(Arc::new(map))
}

/// 只改動前後不同的部分，保留 CRDT 合併多人同時編輯的能力。
/// yrs 預設以 UTF-8 位元組計算位置，所以比對時要對齊字元邊界。
pub(super) fn replace_text(text: &TextRef, txn: &mut yrs::TransactionMut<'_>, next: &str) {
    let current = text.get_string(txn);
    if current == next {
        return;
    }
    let prefix: usize = current
        .chars()
        .zip(next.chars())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum();
    let suffix: usize = current[prefix..]
        .chars()
        .rev()
        .zip(next[prefix..].chars().rev())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum();
    let removed = current.len() - prefix - suffix;
    let inserted = &next[prefix..next.len() - suffix];
    if removed > 0 {
        text.remove_range(txn, prefix as u32, removed as u32);
    }
    if !inserted.is_empty() {
        text.insert(txn, prefix as u32, inserted);
    }
}
