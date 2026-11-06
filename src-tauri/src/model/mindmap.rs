//! 心智圖：節點存在筆記文件的 `mindNodes`，每個節點是一個 Y.Map。
//!
//! 樹的形狀只靠 `parentId` 與 `orderKey`。CRDT 合併時可能出現循環或父節點已被刪除，
//! 例如兩人同時把 A 移到 B 底下、把 B 移到 A 底下，所以讀取時一律整理成合法的樹，
//! 孤立的節點接回根節點，內容不會因此消失。
//!
//! 第一層分支各有一側（`side`）與顏色，新增時就寫進文件，之後插入節點才不會讓別的分支變色。
//! 舊資料沒有這兩個欄位，讀取時補上但不寫回去。更深的節點沿用父節點的顏色，只有使用者指定時
//! 才有自己的 `color`。整張圖的版面（方向、線條）記在根節點上。

use super::types::{MindEdit, MindNode, NoteType};
use super::yjs::{now, out_string};
use super::Alexa;
use crate::order::key_between;
use std::collections::{HashMap, HashSet};
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Out, ReadTxn, Transact, TransactionMut};

pub(super) const ROOT_NODE: &str = "root";
const ROOT_TEXT: &str = "中心主題";
const LEFT: &str = "left";
const RIGHT: &str = "right";
/// 新分支的預設配色。節點文字是深色，這些顏色要能和白底、淡色填滿搭配。
const BRANCH_COLORS: [&str; 8] =
    ["#7b3ff2", "#e0349a", "#16a6c9", "#2f9e5b", "#e8791a", "#3a6df0", "#c9a200", "#d6403a"];

#[derive(Debug, Clone)]
struct RawNode {
    id: String,
    parent_id: Option<String>,
    order_key: String,
    text: String,
    collapsed: bool,
    side: Option<String>,
    color: Option<String>,
    shape: Option<String>,
    orientation: Option<String>,
    line_style: Option<String>,
}

/// 下一個第一層分支該用的一側與顏色。
struct NextBranch {
    side: String,
    color: String,
}

fn nodes_of(doc: &Doc) -> MapRef {
    doc.get_or_insert_map("mindNodes")
}

fn read_raw<T: ReadTxn>(txn: &T, nodes: &MapRef) -> Vec<RawNode> {
    let mut raw: Vec<RawNode> = nodes
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else {
                return None;
            };
            Some(RawNode {
                id: id.to_string(),
                parent_id: out_string(item.get(txn, "parentId")),
                order_key: out_string(item.get(txn, "orderKey")).unwrap_or_default(),
                text: out_string(item.get(txn, "text")).unwrap_or_default(),
                collapsed: matches!(item.get(txn, "collapsed"), Some(Out::Any(Any::Bool(true)))),
                side: out_string(item.get(txn, "side")),
                color: out_string(item.get(txn, "color")),
                shape: out_string(item.get(txn, "shape")),
                orientation: out_string(item.get(txn, "orientation")),
                line_style: out_string(item.get(txn, "lineStyle")),
            })
        })
        .collect();
    // 兩人同時產生相同的鍵時，用 id 讓每台裝置的順序一致。
    raw.sort_by(|a, b| a.order_key.cmp(&b.order_key).then_with(|| a.id.cmp(&b.id)));
    raw
}

fn walk(
    id: &str,
    parent_id: Option<&str>,
    by_id: &HashMap<&str, &RawNode>,
    children: &HashMap<&str, Vec<&str>>,
    visited: &mut HashSet<String>,
    tree: &mut Vec<MindNode>,
) {
    if !visited.insert(id.to_string()) {
        return;
    }
    let Some(node) = by_id.get(id) else {
        return;
    };
    tree.push(MindNode {
        id: id.to_string(),
        parent_id: parent_id.map(str::to_string),
        text: node.text.clone(),
        collapsed: node.collapsed,
        // 分支搬到別層時會清掉 `side`，但合併後仍可能留著，所以只看第一層。
        side: node.side.clone().filter(|_| parent_id == Some(ROOT_NODE)),
        color: node.color.clone(),
        shape: node.shape.clone(),
        orientation: node.orientation.clone(),
        line_style: node.line_style.clone(),
    });
    for child in children.get(id).into_iter().flatten() {
        walk(child, Some(id), by_id, children, visited, tree);
    }
}

/// 從根節點深度優先排好。走不到的節點（循環或父節點已不存在）接到根節點底下。
fn repaired_tree(raw: &[RawNode]) -> Vec<MindNode> {
    let by_id: HashMap<&str, &RawNode> = raw.iter().map(|node| (node.id.as_str(), node)).collect();
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in raw {
        if let Some(parent) = node.parent_id.as_deref() {
            children.entry(parent).or_default().push(&node.id);
        }
    }
    let mut visited = HashSet::new();
    let mut tree = Vec::with_capacity(raw.len());
    walk(ROOT_NODE, None, &by_id, &children, &mut visited, &mut tree);

    // 各裝置要得到相同的結果，所以依固定的順序處理。
    let mut detached: Vec<&str> = raw.iter().map(|node| node.id.as_str()).collect();
    detached.sort_unstable();
    for id in detached {
        walk(id, Some(ROOT_NODE), &by_id, &children, &mut visited, &mut tree);
    }
    settle_branches(&mut tree);
    tree
}

/// 替還沒有一側或顏色的第一層分支補上，回傳再多一條分支時該用的值。
/// 兩邊盡量一樣多，顏色挑用得最少的；同樣少時取前面的，各裝置才會得到相同的結果。
fn settle_branches(tree: &mut [MindNode]) -> NextBranch {
    let is_branch = |node: &MindNode| node.parent_id.as_deref() == Some(ROOT_NODE);
    let lighter_side = |left: usize, right: usize| if right <= left { RIGHT } else { LEFT };
    let rarest_color = |uses: &[usize]| {
        let least = uses.iter().copied().min().unwrap_or(0);
        uses.iter().position(|count| *count == least).unwrap_or(0)
    };

    let (mut left, mut right) = (0, 0);
    let mut uses = [0; BRANCH_COLORS.len()];
    // 先數已經有值的，舊資料補上的值才不會和它們重複。
    for node in tree.iter().filter(|node| is_branch(node)) {
        match node.side.as_deref() {
            Some(LEFT) => left += 1,
            Some(_) => right += 1,
            None => {}
        }
        let slot = node.color.as_deref().and_then(|color| BRANCH_COLORS.iter().position(|item| *item == color));
        if let Some(slot) = slot {
            uses[slot] += 1;
        }
    }
    for node in tree.iter_mut().filter(|node| is_branch(node)) {
        if node.side.is_none() {
            let side = lighter_side(left, right);
            if side == LEFT {
                left += 1;
            } else {
                right += 1;
            }
            node.side = Some(side.to_string());
        }
        if node.color.is_none() {
            let slot = rarest_color(&uses);
            uses[slot] += 1;
            node.color = Some(BRANCH_COLORS[slot].to_string());
        }
    }
    NextBranch {
        side: lighter_side(left, right).to_string(),
        color: BRANCH_COLORS[rarest_color(&uses)].to_string(),
    }
}

fn valid_side(side: Option<&str>) -> Result<(), String> {
    match side {
        None | Some(LEFT | RIGHT) => Ok(()),
        Some(other) => Err(format!("unknown side: {other}")),
    }
}

fn valid_style(key: &str, value: &str) -> bool {
    match key {
        "shape" => matches!(value, "none" | "pill" | "rounded" | "rect"),
        "color" => value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit()),
        "orientation" => matches!(value, "horizontal" | "vertical"),
        "lineStyle" => matches!(value, "curved" | "elbow"),
        _ => false,
    }
}

/// 第一層節點的一側：明確指定的優先，其次跟著旁邊的節點，都沒有就放節點少的那邊。
fn branch_side(tree: &[MindNode], side: Option<&str>, neighbour: Option<&str>, next: &NextBranch) -> String {
    let beside = neighbour.and_then(|id| tree.iter().find(|node| node.id == id)).and_then(|node| node.side.as_deref());
    side.or(beside).unwrap_or(&next.side).to_string()
}

fn sorted_children<'a>(raw: &'a [RawNode], tree: &[MindNode], parent_id: &str, skip: &str) -> Vec<&'a RawNode> {
    let by_id: HashMap<&str, &RawNode> = raw.iter().map(|node| (node.id.as_str(), node)).collect();
    let mut siblings: Vec<&RawNode> = tree
        .iter()
        .filter(|node| node.parent_id.as_deref() == Some(parent_id) && node.id != skip)
        .filter_map(|node| by_id.get(node.id.as_str()).copied())
        .collect();
    siblings.sort_by(|a, b| a.order_key.cmp(&b.order_key).then_with(|| a.id.cmp(&b.id)));
    siblings
}

/// 插到 `position` 這個索引之前的排序鍵。
fn key_at(siblings: &[&RawNode], position: usize) -> Result<String, String> {
    let previous = position.checked_sub(1).and_then(|index| siblings.get(index));
    let next = siblings.get(position);
    key_between(previous.map(|node| node.order_key.as_str()), next.map(|node| node.order_key.as_str()))
}

/// 緊接在 `after` 後面的排序鍵，沒有 `after` 時放最後。
fn key_after_sibling(raw: &[RawNode], tree: &[MindNode], parent_id: &str, after: Option<&str>) -> Result<String, String> {
    let siblings = sorted_children(raw, tree, parent_id, "");
    let position = match after {
        Some(id) => siblings.iter().position(|node| node.id == id).ok_or("unknown sibling")? + 1,
        None => siblings.len(),
    };
    key_at(&siblings, position)
}

/// `node_id` 與它底下的所有節點。
fn subtree(tree: &[MindNode], node_id: &str) -> HashSet<String> {
    let mut found = HashSet::from([node_id.to_string()]);
    // 深度優先的順序保證父節點先出現，掃一遍就夠了。
    for node in tree {
        if node.parent_id.as_ref().is_some_and(|parent| found.contains(parent)) {
            found.insert(node.id.clone());
        }
    }
    found
}

fn field(nodes: &MapRef, txn: &TransactionMut, id: &str) -> Result<MapRef, String> {
    match nodes.get(txn, id) {
        Some(Out::YMap(item)) => Ok(item),
        _ => Err(format!("unknown mind node: {id}")),
    }
}

impl Alexa {
    fn mind_snapshot(&mut self, note_id: &str) -> Result<(Vec<RawNode>, Vec<MindNode>), String> {
        if self.note_type(note_id).as_deref() != Some(NoteType::Mindmap.as_str()) {
            return Err(format!("not a mind map: {note_id}"));
        }
        self.ensure_note(note_id)?;
        let note = self.notes.get(note_id).ok_or("note is not open")?;
        let nodes = nodes_of(&note.doc);
        let txn = note.doc.transact();
        let raw = read_raw(&txn, &nodes);
        let tree = repaired_tree(&raw);
        Ok((raw, tree))
    }

    fn edit_mind_nodes(
        &mut self,
        note_id: &str,
        change: impl FnOnce(&mut TransactionMut, &MapRef) -> Result<(), String>,
    ) -> Result<(), String> {
        self.ensure_note(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let nodes = nodes_of(&note.doc);
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            change(&mut txn, &nodes)?;
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)
    }

    /// 新建的心智圖有一個根節點。`content` 存根節點文字，當成筆記的標題。
    pub(super) fn init_mindmap(&mut self, note_id: &str) -> Result<(), String> {
        let key = key_between(None, None)?;
        self.edit_mind_nodes(note_id, |txn, nodes| {
            let root = nodes.insert(txn, ROOT_NODE, MapPrelim::default());
            root.insert(txn, "orderKey", key);
            root.insert(txn, "text", ROOT_TEXT.to_string());
            Ok(())
        })?;
        self.update_note_content(note_id, ROOT_TEXT)
    }

    pub fn mindmap(&mut self, note_id: &str) -> Result<Vec<MindNode>, String> {
        Ok(self.mind_snapshot(note_id)?.1)
    }

    /// 新節點放在 `parent_id` 底下；有 `after` 時緊接在那個同層節點後面，否則放最後。
    /// `side` 只對第一層有意義，沒給時跟著同層節點或放節點少的那邊。
    pub fn add_mind_node(
        &mut self,
        note_id: &str,
        parent_id: &str,
        after: Option<&str>,
        side: Option<&str>,
    ) -> Result<MindEdit, String> {
        valid_side(side)?;
        let (raw, mut tree) = self.mind_snapshot(note_id)?;
        if !tree.iter().any(|node| node.id == parent_id) {
            return Err(format!("unknown mind node: {parent_id}"));
        }
        let key = key_after_sibling(&raw, &tree, parent_id, after)?;
        let next = settle_branches(&mut tree);
        let branch = (parent_id == ROOT_NODE).then(|| (branch_side(&tree, side, after, &next), next.color.clone()));
        let id = super::yjs::new_id();
        let new_id = id.clone();
        self.edit_mind_nodes(note_id, |txn, nodes| {
            field(nodes, txn, parent_id)?.insert(txn, "collapsed", false);
            let item = nodes.insert(txn, new_id.as_str(), MapPrelim::default());
            item.insert(txn, "parentId", parent_id.to_string());
            item.insert(txn, "orderKey", key);
            item.insert(txn, "text", String::new());
            if let Some((side, color)) = branch {
                item.insert(txn, "side", side);
                item.insert(txn, "color", color);
            }
            Ok(())
        })?;
        Ok(MindEdit { id, nodes: self.mindmap(note_id)? })
    }

    /// 複製節點與它底下的所有節點，放到 `parent_id` 底下。回傳的 `id` 是複本最上層的節點。
    pub fn duplicate_mind_node(
        &mut self,
        note_id: &str,
        node_id: &str,
        parent_id: &str,
        after: Option<&str>,
    ) -> Result<MindEdit, String> {
        if node_id == ROOT_NODE {
            return Err("the root node cannot be duplicated".to_string());
        }
        let (raw, mut tree) = self.mind_snapshot(note_id)?;
        let was_branch = tree
            .iter()
            .find(|node| node.id == node_id)
            .ok_or_else(|| format!("unknown mind node: {node_id}"))?
            .parent_id
            .as_deref()
            == Some(ROOT_NODE);
        if !tree.iter().any(|node| node.id == parent_id) {
            return Err(format!("unknown mind node: {parent_id}"));
        }
        let key = key_after_sibling(&raw, &tree, parent_id, after)?;
        let next = settle_branches(&mut tree);
        let side = branch_side(&tree, None, after, &next);

        let copied = subtree(&tree, node_id);
        let new_ids: HashMap<&str, String> = copied.iter().map(|id| (id.as_str(), super::yjs::new_id())).collect();
        let by_id: HashMap<&str, &RawNode> = raw.iter().map(|node| (node.id.as_str(), node)).collect();
        let top = new_ids[node_id].clone();
        self.edit_mind_nodes(note_id, |txn, nodes| {
            field(nodes, txn, parent_id)?.insert(txn, "collapsed", false);
            for node in tree.iter().filter(|node| copied.contains(&node.id)) {
                let original = by_id[node.id.as_str()];
                let item = nodes.insert(txn, new_ids[node.id.as_str()].as_str(), MapPrelim::default());
                item.insert(txn, "text", original.text.clone());
                item.insert(txn, "collapsed", original.collapsed);
                if let Some(shape) = &original.shape {
                    item.insert(txn, "shape", shape.clone());
                }
                let color = if node.id != node_id {
                    let parent = node.parent_id.as_deref().ok_or("a copied node has no parent")?;
                    item.insert(txn, "parentId", new_ids[parent].clone());
                    item.insert(txn, "orderKey", original.order_key.clone());
                    original.color.clone()
                } else {
                    item.insert(txn, "parentId", parent_id.to_string());
                    item.insert(txn, "orderKey", key.clone());
                    if parent_id == ROOT_NODE {
                        item.insert(txn, "side", side.clone());
                        Some(next.color.clone())
                    } else {
                        // 第一層的顏色是分支自己的，放到別的分支底下就沿用那條分支。
                        original.color.clone().filter(|_| !was_branch)
                    }
                };
                if let Some(color) = color {
                    item.insert(txn, "color", color);
                }
            }
            Ok(())
        })?;
        Ok(MindEdit { id: top, nodes: self.mindmap(note_id)? })
    }

    pub fn rename_mind_node(&mut self, note_id: &str, node_id: &str, text: &str) -> Result<Vec<MindNode>, String> {
        self.mind_snapshot(note_id)?;
        self.edit_mind_nodes(note_id, |txn, nodes| {
            field(nodes, txn, node_id)?.insert(txn, "text", text.to_string());
            Ok(())
        })?;
        if node_id == ROOT_NODE {
            self.update_note_content(note_id, text)?;
        }
        self.mindmap(note_id)
    }

    pub fn set_mind_collapsed(&mut self, note_id: &str, node_id: &str, collapsed: bool) -> Result<Vec<MindNode>, String> {
        self.mind_snapshot(note_id)?;
        self.edit_mind_nodes(note_id, |txn, nodes| {
            field(nodes, txn, node_id)?.insert(txn, "collapsed", collapsed);
            Ok(())
        })?;
        self.mindmap(note_id)
    }

    /// 改節點的形狀、顏色，或根節點上整張圖的版面。換顏色時整條分支一起換。
    pub fn set_mind_style(&mut self, note_id: &str, node_id: &str, key: &str, value: &str) -> Result<Vec<MindNode>, String> {
        if !valid_style(key, value) {
            return Err(format!("invalid mind style: {key}={value}"));
        }
        if matches!(key, "orientation" | "lineStyle") && node_id != ROOT_NODE {
            return Err("the layout belongs to the root node".to_string());
        }
        let (_, tree) = self.mind_snapshot(note_id)?;
        let mut below = subtree(&tree, node_id);
        below.remove(node_id);
        self.edit_mind_nodes(note_id, |txn, nodes| {
            field(nodes, txn, node_id)?.insert(txn, key, value.to_string());
            if key == "color" {
                for id in &below {
                    field(nodes, txn, id)?.remove(txn, "color");
                }
            }
            Ok(())
        })?;
        self.mindmap(note_id)
    }

    /// 第一層分支重新配色，底下的節點回到沿用分支顏色。根節點不變。
    pub fn randomize_mind_colors(&mut self, note_id: &str) -> Result<Vec<MindNode>, String> {
        let (_, tree) = self.mind_snapshot(note_id)?;
        let mut palette: Vec<(u8, &str)> = uuid::Uuid::new_v4().into_bytes().into_iter().zip(BRANCH_COLORS).collect();
        palette.sort_unstable();
        self.edit_mind_nodes(note_id, |txn, nodes| {
            let mut colors = palette.iter().cycle();
            for node in tree.iter().filter(|node| node.parent_id.is_some()) {
                let item = field(nodes, txn, &node.id)?;
                if node.parent_id.as_deref() == Some(ROOT_NODE) {
                    let (_, color) = colors.next().ok_or("the palette is empty")?;
                    item.insert(txn, "color", color.to_string());
                } else {
                    item.remove(txn, "color");
                }
            }
            Ok(())
        })?;
        self.mindmap(note_id)
    }

    /// 連同底下的節點一起刪除。根節點不能刪。
    pub fn delete_mind_node(&mut self, note_id: &str, node_id: &str) -> Result<Vec<MindNode>, String> {
        if node_id == ROOT_NODE {
            return Err("the root node cannot be deleted".to_string());
        }
        let (_, tree) = self.mind_snapshot(note_id)?;
        if !tree.iter().any(|node| node.id == node_id) {
            return Err(format!("unknown mind node: {node_id}"));
        }
        let doomed = subtree(&tree, node_id);
        self.edit_mind_nodes(note_id, |txn, nodes| {
            for id in &doomed {
                nodes.remove(txn, id);
            }
            Ok(())
        })?;
        self.mindmap(note_id)
    }

    /// 移到 `parent_id` 底下，放在 `before` 前面；沒有 `before` 時放最後。
    /// 離開第一層時改為沿用新分支的顏色。
    pub fn move_mind_node(
        &mut self,
        note_id: &str,
        node_id: &str,
        parent_id: &str,
        before: Option<&str>,
        side: Option<&str>,
    ) -> Result<Vec<MindNode>, String> {
        if node_id == ROOT_NODE {
            return Err("the root node cannot be moved".to_string());
        }
        valid_side(side)?;
        let (raw, mut tree) = self.mind_snapshot(note_id)?;
        if !tree.iter().any(|node| node.id == parent_id) {
            return Err(format!("unknown mind node: {parent_id}"));
        }
        if subtree(&tree, node_id).contains(parent_id) {
            return Err("a node cannot move into itself".to_string());
        }
        let siblings = sorted_children(&raw, &tree, parent_id, node_id);
        let position = match before {
            Some(id) => siblings.iter().position(|node| node.id == id).ok_or("unknown sibling")?,
            None => siblings.len(),
        };
        let key = key_at(&siblings, position)?;
        let next = settle_branches(&mut tree);
        let node = tree.iter().find(|node| node.id == node_id).ok_or("unknown mind node")?;
        let was_branch = node.parent_id.as_deref() == Some(ROOT_NODE);
        let neighbour = before.or(Some(node_id).filter(|_| was_branch));
        let branch = (parent_id == ROOT_NODE).then(|| {
            (branch_side(&tree, side, neighbour, &next), node.color.clone().unwrap_or_else(|| next.color.clone()))
        });
        self.edit_mind_nodes(note_id, |txn, nodes| {
            field(nodes, txn, parent_id)?.insert(txn, "collapsed", false);
            let item = field(nodes, txn, node_id)?;
            item.insert(txn, "parentId", parent_id.to_string());
            item.insert(txn, "orderKey", key);
            if let Some((side, color)) = branch {
                item.insert(txn, "side", side);
                item.insert(txn, "color", color);
            } else if was_branch {
                item.remove(txn, "side");
                item.remove(txn, "color");
            }
            Ok(())
        })?;
        self.mindmap(note_id)
    }
}
