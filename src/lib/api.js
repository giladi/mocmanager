import { supabase } from "./supabase";

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function listMocs() {
  const { data, error } = await supabase
    .from("mocs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createMoc({ name, url, sourceFileName, userId }) {
  const { data, error } = await supabase
    .from("mocs")
    .insert({
      user_id: userId,
      name,
      url: url || null,
      source_file_name: sourceFileName || null
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMoc(id, patch) {
  const payload = {};
  if ("name" in patch) payload.name = patch.name;
  if ("url" in patch) payload.url = patch.url || null;

  const { data, error } = await supabase
    .from("mocs")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMoc(id) {
  const { error } = await supabase.from("mocs").delete().eq("id", id);
  if (error) throw error;
}

export async function listMocParts(mocId) {
  const { data, error } = await supabase
    .from("moc_parts")
    .select("*")
    .eq("moc_id", mocId)
    .order("part_number", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listAllPartsForUser() {
  const { data, error } = await supabase
    .from("moc_parts")
    .select("*, mocs!inner(id, name, url)")
    .order("part_number", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createPart(mocId, part) {
  const { data, error } = await supabase
    .from("moc_parts")
    .insert({
      moc_id: mocId,
      part_number: part.partNumber,
      color: part.color,
      required_qty: part.requiredQty,
      have_qty: part.haveQty ?? 0,
      ordered: !!part.ordered,
      arrived: !!part.arrived,
      completed: !!part.completed
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePart(id, patch) {
  const payload = {};
  if ("partNumber" in patch) payload.part_number = patch.partNumber;
  if ("color" in patch) payload.color = patch.color;
  if ("requiredQty" in patch) payload.required_qty = patch.requiredQty;
  if ("haveQty" in patch) payload.have_qty = patch.haveQty;
  if ("ordered" in patch) payload.ordered = patch.ordered;
  if ("arrived" in patch) payload.arrived = patch.arrived;
  if ("completed" in patch) payload.completed = patch.completed;

  const { data, error } = await supabase
    .from("moc_parts")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePart(id) {
  const { error } = await supabase.from("moc_parts").delete().eq("id", id);
  if (error) throw error;
}


export async function listOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(id, moc_part_id)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createOrder({ name, vendor, orderDate, trackingNumber, notes, status, userId }) {
  const { data, error } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      name,
      vendor: vendor || null,
      order_date: orderDate || null,
      tracking_number: trackingNumber || null,
      notes: notes || null,
      status: status || "draft"
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateOrder(id, patch) {
  const payload = {};
  if ("name" in patch) payload.name = patch.name;
  if ("vendor" in patch) payload.vendor = patch.vendor || null;
  if ("orderDate" in patch) payload.order_date = patch.orderDate || null;
  if ("trackingNumber" in patch) payload.tracking_number = patch.trackingNumber || null;
  if ("notes" in patch) payload.notes = patch.notes || null;
  if ("status" in patch) payload.status = patch.status || "draft";
  const { data, error } = await supabase
    .from("orders")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteOrder(id) {
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw error;
}

export async function addPartToOrder(orderId, mocPartId) {
  const { error } = await supabase
    .from("order_items")
    .upsert({ order_id: orderId, moc_part_id: mocPartId }, { onConflict: "order_id,moc_part_id" });
  if (error) throw error;
}

export async function removePartFromOrder(orderId, mocPartId) {
  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("order_id", orderId)
    .eq("moc_part_id", mocPartId);
  if (error) throw error;
}
