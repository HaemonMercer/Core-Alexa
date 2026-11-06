use super::super::mindmap::ROOT_NODE;
use super::*;

fn mindmap(alexa: &mut Alexa) -> String {
    let board = new_board(alexa);
    let created = alexa.create_note(&board, NoteType::Mindmap, 0.0, 0.0).unwrap();
    created.board.placed_notes.iter().find(|note| note.id == created.placed_id).unwrap().note_id.clone()
}

fn child(alexa: &mut Alexa, note: &str, parent: &str, text: &str) -> String {
    let id = alexa.add_mind_node(note, parent, None, None).unwrap().id;
    alexa.rename_mind_node(note, &id, text).unwrap();
    id
}

fn texts(nodes: &[MindNode]) -> Vec<&str> {
    nodes.iter().map(|node| node.text.as_str()).collect()
}

/// 直接改文件，模擬兩台裝置同時編輯後合併的結果。
fn set_parent(alexa: &mut Alexa, note: &str, node: &str, parent: &str) {
    let doc = &alexa.notes.get(note).unwrap().doc;
    let nodes = doc.get_or_insert_map("mindNodes");
    let mut txn = doc.transact_mut();
    let Some(yrs::Out::YMap(item)) = nodes.get(&txn, node) else { panic!("no node") };
    item.insert(&mut txn, "parentId", parent.to_string());
}

#[test]
fn a_new_mind_map_has_a_root_used_as_its_title() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let nodes = alexa.mindmap(&note).unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].parent_id, None);

    alexa.rename_mind_node(&note, ROOT_NODE, "專案規劃").unwrap();
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "專案規劃");
}

#[test]
fn nodes_survive_restart_in_depth_first_order() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    child(&mut alexa, &note, ROOT_NODE, "乙");
    child(&mut alexa, &note, &a, "甲一");

    let mut alexa = reopen(alexa);
    assert_eq!(texts(&alexa.mindmap(&note).unwrap()), ["中心主題", "甲", "甲一", "乙"]);
}

#[test]
fn a_sibling_can_be_inserted_between_two_nodes_many_times() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let first = child(&mut alexa, &note, ROOT_NODE, "頭");
    child(&mut alexa, &note, ROOT_NODE, "尾");
    for round in 0..60 {
        let id = alexa.add_mind_node(&note, ROOT_NODE, Some(&first), None).unwrap().id;
        alexa.rename_mind_node(&note, &id, &round.to_string()).unwrap();
    }
    let nodes = alexa.mindmap(&note).unwrap();
    let order = texts(&nodes);
    assert_eq!(order[1], "頭");
    assert_eq!(order[2], "59");
    assert_eq!(order[61], "0");
    assert_eq!(order[62], "尾");
}

#[test]
fn deleting_removes_the_subtree_but_never_the_root() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    child(&mut alexa, &note, &a, "甲一");
    child(&mut alexa, &note, ROOT_NODE, "乙");

    assert_eq!(texts(&alexa.delete_mind_node(&note, &a).unwrap()), ["中心主題", "乙"]);
    assert!(alexa.delete_mind_node(&note, ROOT_NODE).is_err());
    assert!(alexa.delete_mind_node(&note, "missing").is_err());
}

#[test]
fn moves_a_node_with_its_children_before_a_sibling() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, ROOT_NODE, "乙");
    let c = child(&mut alexa, &note, &b, "乙一");
    child(&mut alexa, &note, &c, "乙一甲");

    let nodes = alexa.move_mind_node(&note, &c, ROOT_NODE, Some(&a), None).unwrap();
    assert_eq!(texts(&nodes), ["中心主題", "乙一", "乙一甲", "甲", "乙"]);

    let nodes = alexa.move_mind_node(&note, &a, &b, None, None).unwrap();
    assert_eq!(texts(&nodes), ["中心主題", "乙一", "乙一甲", "乙", "甲"]);
    assert_eq!(nodes[4].parent_id.as_deref(), Some(b.as_str()));
}

#[test]
fn reordering_within_the_same_parent_works_in_both_directions() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, ROOT_NODE, "乙");
    let c = child(&mut alexa, &note, ROOT_NODE, "丙");

    assert_eq!(texts(&alexa.move_mind_node(&note, &c, ROOT_NODE, Some(&a), None).unwrap())[1..], ["丙", "甲", "乙"]);
    assert_eq!(texts(&alexa.move_mind_node(&note, &c, ROOT_NODE, None, None).unwrap())[1..], ["甲", "乙", "丙"]);
    assert_eq!(texts(&alexa.move_mind_node(&note, &a, ROOT_NODE, Some(&c), None).unwrap())[1..], ["乙", "甲", "丙"]);
    let _ = b;
}

#[test]
fn refuses_moves_that_would_break_the_tree() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, &a, "甲一");

    assert!(alexa.move_mind_node(&note, &a, &b, None, None).is_err());
    assert!(alexa.move_mind_node(&note, &a, &a, None, None).is_err());
    assert!(alexa.move_mind_node(&note, ROOT_NODE, &a, None, None).is_err());
    assert!(alexa.move_mind_node(&note, &a, "missing", None, None).is_err());
}

#[test]
fn adding_or_moving_into_a_collapsed_node_opens_it() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    alexa.set_mind_collapsed(&note, &a, true).unwrap();
    let edit = alexa.add_mind_node(&note, &a, None, None).unwrap();
    assert!(!edit.nodes.iter().find(|node| node.id == a).unwrap().collapsed);
}

#[test]
fn a_merged_cycle_is_repaired_without_losing_nodes() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, ROOT_NODE, "乙");
    set_parent(&mut alexa, &note, &a, &b);
    set_parent(&mut alexa, &note, &b, &a);

    let nodes = alexa.mindmap(&note).unwrap();
    assert_eq!(nodes.len(), 3);
    let detached = nodes.iter().filter(|node| node.parent_id.as_deref() == Some(ROOT_NODE)).count();
    assert_eq!(detached, 1);
    // 修復後一切操作照常。
    assert!(alexa.add_mind_node(&note, &b, None, None).is_ok());
    assert_eq!(alexa.mindmap(&note).unwrap().len(), 4);
}

#[test]
fn a_node_whose_parent_was_deleted_elsewhere_stays_visible() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    set_parent(&mut alexa, &note, &a, "deleted-on-another-device");

    let nodes = alexa.mindmap(&note).unwrap();
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[1].parent_id.as_deref(), Some(ROOT_NODE));
}

#[test]
fn only_mind_maps_accept_these_operations() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let card = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let card_id = card.board.placed_notes[0].note_id.clone();
    assert!(alexa.mindmap(&card_id).is_err());
    assert!(alexa.add_mind_node(&card_id, ROOT_NODE, None, None).is_err());
}

fn node<'a>(nodes: &'a [MindNode], id: &str) -> &'a MindNode {
    nodes.iter().find(|item| item.id == id).unwrap()
}

fn fresh() -> Alexa {
    Alexa::with_connection(memory()).unwrap()
}

#[test]
fn branches_alternate_sides_and_get_their_own_colors() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, ROOT_NODE, "乙");
    let a1 = child(&mut alexa, &note, &a, "甲一");
    let nodes = alexa.mindmap(&note).unwrap();

    assert_eq!(node(&nodes, &a).side.as_deref(), Some("right"));
    assert_eq!(node(&nodes, &b).side.as_deref(), Some("left"));
    assert_ne!(node(&nodes, &a).color, node(&nodes, &b).color);
    assert_eq!(node(&nodes, &a1).color, None, "更深的節點沿用分支顏色");
}

#[test]
fn a_new_branch_leaves_the_other_branches_unchanged() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, ROOT_NODE, "乙");
    let before = alexa.mindmap(&note).unwrap();
    let inserted = alexa.add_mind_node(&note, ROOT_NODE, Some(&a), None).unwrap();

    for id in [&a, &b] {
        assert_eq!(node(&inserted.nodes, id).color, node(&before, id).color);
    }
    assert_eq!(node(&inserted.nodes, &inserted.id).side, node(&before, &a).side, "Enter 跟著同層節點的一側");
}

#[test]
fn an_explicit_side_wins_and_unknown_sides_are_rejected() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let id = alexa.add_mind_node(&note, ROOT_NODE, None, Some("left")).unwrap().id;
    assert_eq!(node(&alexa.mindmap(&note).unwrap(), &id).side.as_deref(), Some("left"));
    assert!(alexa.add_mind_node(&note, ROOT_NODE, None, Some("up")).is_err());
}

/// 舊版建立的節點沒有 `side` 與 `color`。
fn forget_branch(alexa: &mut Alexa, note: &str, id: &str) {
    let doc = &alexa.notes.get(note).unwrap().doc;
    let nodes = doc.get_or_insert_map("mindNodes");
    let mut txn = doc.transact_mut();
    let Some(yrs::Out::YMap(item)) = nodes.get(&txn, id) else { panic!("no node") };
    item.remove(&mut txn, "side");
    item.remove(&mut txn, "color");
}

#[test]
fn old_maps_are_balanced_when_read() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let ids: Vec<String> = ["甲", "乙", "丙", "丁"].iter().map(|text| child(&mut alexa, &note, ROOT_NODE, text)).collect();
    for id in &ids {
        forget_branch(&mut alexa, &note, id);
    }
    let nodes = alexa.mindmap(&note).unwrap();
    let left = ids.iter().filter(|id| node(&nodes, id).side.as_deref() == Some("left")).count();
    assert_eq!(left, 2);
    let colors: std::collections::HashSet<_> = ids.iter().map(|id| node(&nodes, id).color.clone().unwrap()).collect();
    assert_eq!(colors.len(), 4);
    assert_eq!(alexa.mindmap(&note).unwrap(), nodes, "每次讀到的結果要一樣");
}

#[test]
fn styles_are_validated_and_a_new_color_covers_the_branch() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let a1 = child(&mut alexa, &note, &a, "甲一");
    alexa.set_mind_style(&note, &a1, "color", "#112233").unwrap();
    let nodes = alexa.set_mind_style(&note, &a, "color", "#445566").unwrap();

    assert_eq!(node(&nodes, &a).color.as_deref(), Some("#445566"));
    assert_eq!(node(&nodes, &a1).color, None);
    assert!(alexa.set_mind_style(&note, &a, "color", "red").is_err());
    assert!(alexa.set_mind_style(&note, &a, "shape", "star").is_err());
    assert!(alexa.set_mind_style(&note, &a, "text", "x").is_err());
    assert!(alexa.set_mind_style(&note, &a, "orientation", "vertical").is_err(), "版面只能設在根節點");

    let nodes = alexa.set_mind_style(&note, ROOT_NODE, "orientation", "vertical").unwrap();
    assert_eq!(node(&nodes, ROOT_NODE).orientation.as_deref(), Some("vertical"));
    assert_eq!(reopen(alexa).mindmap(&note).unwrap(), nodes);
}

#[test]
fn moving_a_branch_updates_side_and_color() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let b = child(&mut alexa, &note, ROOT_NODE, "乙");

    let nodes = alexa.move_mind_node(&note, &a, ROOT_NODE, None, Some("left")).unwrap();
    assert_eq!(node(&nodes, &a).side.as_deref(), Some("left"));

    let nodes = alexa.move_mind_node(&note, &a, &b, None, None).unwrap();
    assert_eq!((node(&nodes, &a).side.clone(), node(&nodes, &a).color.clone()), (None, None));

    let nodes = alexa.move_mind_node(&note, &a, ROOT_NODE, None, None).unwrap();
    assert!(node(&nodes, &a).side.is_some() && node(&nodes, &a).color.is_some());
}

#[test]
fn duplicating_copies_the_whole_subtree() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    child(&mut alexa, &note, &a, "甲一");
    alexa.set_mind_style(&note, &a, "shape", "pill").unwrap();

    let copy = alexa.duplicate_mind_node(&note, &a, ROOT_NODE, Some(&a)).unwrap();
    assert_eq!(texts(&copy.nodes), ["中心主題", "甲", "甲一", "甲", "甲一"]);
    let top = node(&copy.nodes, &copy.id);
    assert_eq!(top.shape.as_deref(), Some("pill"));
    assert_eq!(top.side, node(&copy.nodes, &a).side);
    assert_ne!(top.color, node(&copy.nodes, &a).color);
    assert_eq!(copy.nodes[4].parent_id.as_deref(), Some(copy.id.as_str()));
    assert!(alexa.duplicate_mind_node(&note, ROOT_NODE, ROOT_NODE, None).is_err());

    let c = child(&mut alexa, &note, ROOT_NODE, "丙");
    let inside = alexa.duplicate_mind_node(&note, &a, &c, None).unwrap();
    assert_eq!(node(&inside.nodes, &inside.id).color, None, "放到別的分支底下就沿用那條分支的顏色");
    assert_eq!(reopen(alexa).mindmap(&note).unwrap(), inside.nodes);
}

#[test]
fn randomizing_recolors_branches_and_clears_overrides() {
    let mut alexa = fresh();
    let note = mindmap(&mut alexa);
    let a = child(&mut alexa, &note, ROOT_NODE, "甲");
    let a1 = child(&mut alexa, &note, &a, "甲一");
    alexa.set_mind_style(&note, &a1, "color", "#112233").unwrap();
    let nodes = alexa.randomize_mind_colors(&note).unwrap();

    assert!(node(&nodes, &a).color.is_some());
    assert_eq!(node(&nodes, &a1).color, None);
    assert_eq!(node(&nodes, ROOT_NODE).color, None);
}
