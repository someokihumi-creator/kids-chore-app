import {
  waitForAuth,
  subscribeKids, addKid, updateKid, deleteKid,
  subscribeChores, addChore, updateChore, deleteChore,
  subscribeRewards, addReward, updateReward, deleteReward,
  subscribeCompletions, requestCompletion, decideCompletion,
  subscribeRedemptions, requestRedemption, decideRedemption,
  subscribeStreaks, subscribeBonuses,
} from "./db.js";

const appEl = document.getElementById("app");

const state = {
  kids: [],
  chores: [],
  rewards: [],
  completions: [],
  redemptions: [],
  streaks: [],
  bonuses: [],
  screen: "loading", // 'profile-picker' | 'kid-home' | 'parent-home'
  currentKidId: null,
  activeTab: { kid: "chores", parent: "approvals" },
};

function tpl(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function fillSlots(root, values) {
  for (const [key, val] of Object.entries(values)) {
    const el = root.querySelector(`[data-slot="${key}"]`);
    if (el) el.textContent = val;
  }
}

function fmtDate(ts) {
  if (!ts || !ts.toDate) return "たった今";
  return ts.toDate().toLocaleString("ja-JP", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)",
    background: "#3a3a3a", color: "white", padding: "10px 18px", borderRadius: "999px",
    fontSize: "0.9rem", zIndex: 999, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ---------------- routing ----------------
function goHome() {
  state.screen = "profile-picker";
  state.currentKidId = null;
  render();
}

function goKid(kidId) {
  state.screen = "kid-home";
  state.currentKidId = kidId;
  state.activeTab.kid = "chores";
  render();
}

function goParent() {
  state.screen = "parent-home";
  state.activeTab.parent = "approvals";
  render();
}

// ---------------- render ----------------
function render() {
  appEl.innerHTML = "";
  if (state.screen === "profile-picker") renderProfilePicker();
  else if (state.screen === "kid-home") renderKidHome();
  else if (state.screen === "parent-home") renderParentHome();
}

function renderProfilePicker() {
  const frag = tpl("tpl-profile-picker");
  const grid = frag.querySelector('[data-slot="kids"]');
  if (state.kids.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "まだこどもが登録されていません。「おうちの人」からついかしてね。";
    grid.appendChild(p);
  }
  for (const kid of state.kids) {
    const card = tpl("tpl-kid-card");
    fillSlots(card, { emoji: kid.emoji || "🙂", name: kid.name, points: `${kid.points || 0} pt` });
    card.querySelector('[data-action="pick-kid"]').addEventListener("click", () => goKid(kid.id));
    grid.appendChild(card);
  }
  frag.querySelector('[data-action="go-parent"]').addEventListener("click", goParent);
  appEl.appendChild(frag);
}

function renderKidHome() {
  const kid = state.kids.find((k) => k.id === state.currentKidId);
  if (!kid) return goHome();

  const frag = tpl("tpl-kid-home");
  fillSlots(frag, { emoji: kid.emoji || "🙂", name: kid.name, points: `${kid.points || 0}` });
  frag.querySelector('[data-action="go-home"]').addEventListener("click", goHome);

  const root = frag.querySelector(".kid-home");
  wireTabs(root, "kid");

  // chores
  const choreList = root.querySelector('[data-slot="chore-list"]');
  const activeChores = state.chores.filter((c) => c.active !== false);
  if (activeChores.length === 0) emptyHint(choreList, "おてつだいがまだ登録されていません。");
  for (const chore of activeChores) {
    const item = tpl("tpl-chore-item");
    fillSlots(item, { name: chore.name, points: `${chore.points} pt` });
    if (chore.streakDays > 0) {
      const streak = state.streaks.find((s) => s.id === `${kid.id}_${chore.id}`);
      const current = streak?.currentStreak || 0;
      const remaining = chore.streakDays - current;
      item.querySelector('[data-slot="streak"]').textContent =
        current > 0
          ? `🔥 ${current}/${chore.streakDays}日連続 (あと${remaining}日で+${chore.streakBonus}pt)`
          : `🔥 ${chore.streakDays}日連続で+${chore.streakBonus}pt`;
    }
    const pending = state.completions.some(
      (c) => c.kidId === kid.id && c.choreId === chore.id && c.status === "pending"
    );
    const btn = item.querySelector('[data-action="do-chore"]');
    if (pending) {
      btn.textContent = "しんせいちゅう...";
      btn.disabled = true;
    }
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await requestCompletion(kid, chore);
      toast("おうちの人にかくにんしてもらってね！");
    });
    choreList.appendChild(item);
  }

  // rewards
  const rewardList = root.querySelector('[data-slot="reward-list"]');
  const activeRewards = state.rewards.filter((r) => r.active !== false);
  if (activeRewards.length === 0) emptyHint(rewardList, "ごほうびがまだ登録されていません。");
  for (const reward of activeRewards) {
    const item = tpl("tpl-reward-item");
    fillSlots(item, { name: reward.name, cost: `${reward.cost} pt` });
    const btn = item.querySelector('[data-action="do-redeem"]');
    const affordable = (kid.points || 0) >= reward.cost;
    if (!affordable) btn.disabled = true;
    btn.addEventListener("click", async () => {
      if (!confirm(`「${reward.name}」と こうかんする？ (-${reward.cost}pt)`)) return;
      btn.disabled = true;
      await requestRedemption(kid, reward);
      toast("おうちの人にかくにんしてもらってね！");
    });
    rewardList.appendChild(item);
  }

  // history
  const historyList = root.querySelector('[data-slot="history-list"]');
  const myHistory = [
    ...state.completions.filter((c) => c.kidId === kid.id).map((c) => ({ ...c, kind: "chore" })),
    ...state.redemptions.filter((r) => r.kidId === kid.id).map((r) => ({ ...r, kind: "reward" })),
    ...state.bonuses.filter((b) => b.kidId === kid.id).map((b) => ({ ...b, kind: "bonus" })),
  ].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (myHistory.length === 0) emptyHint(historyList, "きろくはまだありません。");
  for (const h of myHistory) {
    const item = tpl("tpl-history-item");
    const icon = h.kind === "bonus" ? "🔥" : h.status === "pending" ? "⏳" : h.status === "approved" ? "✅" : "❌";
    const text =
      h.kind === "chore"
        ? `${h.choreName} (+${h.points}pt)`
        : h.kind === "reward"
        ? `${h.rewardName} と こうかん (-${h.cost}pt)`
        : `${h.choreName} ${h.days}日連続ボーナス (+${h.points}pt)`;
    fillSlots(item, { status: icon, text, date: fmtDate(h.createdAt) });
    historyList.appendChild(item);
  }

  appEl.appendChild(frag);
}

function renderParentHome() {
  const frag = tpl("tpl-parent-home");
  frag.querySelector('[data-action="go-home"]').addEventListener("click", goHome);
  const root = frag.querySelector(".parent-home");
  wireTabs(root, "parent");

  const pendingCompletions = state.completions.filter((c) => c.status === "pending");
  const pendingRedemptions = state.redemptions.filter((r) => r.status === "pending");
  const badge = frag.querySelector('[data-slot="pending-badge"]');
  const totalPending = pendingCompletions.length + pendingRedemptions.length;
  if (totalPending > 0) {
    badge.textContent = totalPending;
  } else {
    badge.remove();
  }

  // approvals
  const compList = root.querySelector('[data-slot="pending-completions"]');
  if (pendingCompletions.length === 0) emptyHint(compList, "しんせいはありません。");
  for (const c of pendingCompletions) {
    const item = tpl("tpl-approval-item");
    fillSlots(item, { text: `${c.kidName}: ${c.choreName}`, sub: `+${c.points}pt` });
    item.querySelector('[data-action="approve"]').addEventListener("click", () => decideCompletion(c.id, true));
    item.querySelector('[data-action="reject"]').addEventListener("click", () => decideCompletion(c.id, false));
    compList.appendChild(item);
  }

  const redList = root.querySelector('[data-slot="pending-redemptions"]');
  if (pendingRedemptions.length === 0) emptyHint(redList, "しんせいはありません。");
  for (const r of pendingRedemptions) {
    const item = tpl("tpl-approval-item");
    fillSlots(item, { text: `${r.kidName}: ${r.rewardName}`, sub: `-${r.cost}pt` });
    item.querySelector('[data-action="approve"]').addEventListener("click", () => decideRedemption(r.id, true));
    item.querySelector('[data-action="reject"]').addEventListener("click", () => decideRedemption(r.id, false));
    redList.appendChild(item);
  }

  // manage: kids
  const manageKids = root.querySelector('[data-slot="manage-kids"]');
  for (const kid of state.kids) {
    const row = manageRow({ emoji: kid.emoji, name: kid.name, value: `${kid.points || 0}pt`, showToggle: false });
    row.querySelector('[data-action="delete-item"]').addEventListener("click", () => {
      if (confirm(`「${kid.name}」を削除しますか？`)) deleteKid(kid.id);
    });
    manageKids.appendChild(row);
  }
  root.querySelector('[data-form="add-kid"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.querySelector('[data-field="name"]').value.trim();
    const emoji = form.querySelector('[data-field="emoji"]').value.trim() || "🙂";
    if (!name) return;
    addKid(name, emoji);
    form.reset();
  });

  // manage: chores
  const manageChores = root.querySelector('[data-slot="manage-chores"]');
  for (const chore of state.chores) {
    const row = manageRow({
      emoji: "🧹", name: chore.name, value: `${chore.points}pt`,
      showToggle: true, active: chore.active !== false,
    });
    const rowEl = row.querySelector(".manage-row");
    const deleteBtn = rowEl.querySelector('[data-action="delete-item"]');

    const daysInput = document.createElement("input");
    daysInput.type = "number";
    daysInput.min = "0";
    daysInput.placeholder = "連続日";
    daysInput.className = "streak-input";
    daysInput.value = chore.streakDays || "";
    const bonusInput = document.createElement("input");
    bonusInput.type = "number";
    bonusInput.min = "0";
    bonusInput.placeholder = "ボーナスpt";
    bonusInput.className = "streak-input";
    bonusInput.value = chore.streakBonus || "";
    const saveStreakBtn = document.createElement("button");
    saveStreakBtn.className = "btn-icon";
    saveStreakBtn.textContent = "🔥";
    saveStreakBtn.title = "連続ボーナスを保存（両方0で解除）";
    saveStreakBtn.addEventListener("click", () => {
      const days = parseInt(daysInput.value, 10) || 0;
      const bonus = parseInt(bonusInput.value, 10) || 0;
      updateChore(chore.id, { streakDays: days, streakBonus: bonus });
    });
    rowEl.insertBefore(daysInput, deleteBtn);
    rowEl.insertBefore(bonusInput, deleteBtn);
    rowEl.insertBefore(saveStreakBtn, deleteBtn);

    row.querySelector('[data-action="toggle-active"]').addEventListener("click", () =>
      updateChore(chore.id, { active: chore.active === false })
    );
    row.querySelector('[data-action="delete-item"]').addEventListener("click", () => {
      if (confirm(`「${chore.name}」を削除しますか？`)) deleteChore(chore.id);
    });
    manageChores.appendChild(row);
  }
  root.querySelector('[data-form="add-chore"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.querySelector('[data-field="name"]').value.trim();
    const points = parseInt(form.querySelector('[data-field="points"]').value, 10);
    if (!name || !points) return;
    addChore(name, points);
    form.reset();
  });

  // manage: rewards
  const manageRewards = root.querySelector('[data-slot="manage-rewards"]');
  for (const reward of state.rewards) {
    const row = manageRow({
      emoji: "🎁", name: reward.name, value: `${reward.cost}pt`,
      showToggle: true, active: reward.active !== false,
    });
    row.querySelector('[data-action="toggle-active"]').addEventListener("click", () =>
      updateReward(reward.id, { active: reward.active === false })
    );
    row.querySelector('[data-action="delete-item"]').addEventListener("click", () => {
      if (confirm(`「${reward.name}」を削除しますか？`)) deleteReward(reward.id);
    });
    manageRewards.appendChild(row);
  }
  root.querySelector('[data-form="add-reward"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.querySelector('[data-field="name"]').value.trim();
    const cost = parseInt(form.querySelector('[data-field="cost"]').value, 10);
    if (!name || !cost) return;
    addReward(name, cost);
    form.reset();
  });

  // history (all)
  const allHistory = [
    ...state.completions.map((c) => ({ ...c, kind: "chore" })),
    ...state.redemptions.map((r) => ({ ...r, kind: "reward" })),
    ...state.bonuses.map((b) => ({ ...b, kind: "bonus" })),
  ].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const historyList = root.querySelector('[data-slot="all-history"]');
  if (allHistory.length === 0) emptyHint(historyList, "きろくはまだありません。");
  for (const h of allHistory) {
    const item = tpl("tpl-history-item");
    const icon = h.kind === "bonus" ? "🔥" : h.status === "pending" ? "⏳" : h.status === "approved" ? "✅" : "❌";
    const text =
      h.kind === "chore"
        ? `${h.kidName}: ${h.choreName} (+${h.points}pt)`
        : h.kind === "reward"
        ? `${h.kidName}: ${h.rewardName} と こうかん (-${h.cost}pt)`
        : `${h.kidName}: ${h.choreName} ${h.days}日連続ボーナス (+${h.points}pt)`;
    fillSlots(item, { status: icon, text, date: fmtDate(h.createdAt) });
    historyList.appendChild(item);
  }

  appEl.appendChild(frag);
}

function manageRow({ emoji, name, value, showToggle, active }) {
  const row = tpl("tpl-manage-row");
  fillSlots(row, { emoji: emoji || "", name, value });
  const toggleBtn = row.querySelector('[data-action="toggle-active"]');
  if (showToggle) {
    toggleBtn.textContent = active ? "🟢" : "⚪️";
    row.querySelector(".manage-row").classList?.toggle("inactive-row", !active);
  } else {
    toggleBtn.remove();
  }
  return row;
}

function emptyHint(container, msg) {
  const p = document.createElement("p");
  p.className = "empty-hint";
  p.textContent = msg;
  container.appendChild(p);
}

function wireTabs(root, group) {
  const tabs = root.querySelectorAll(".tab");
  const panels = root.querySelectorAll(".tab-panel");
  const activate = (name) => {
    state.activeTab[group] = name;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== name));
  };
  tabs.forEach((t) => t.addEventListener("click", () => activate(t.dataset.tab)));
  activate(state.activeTab[group]);
}

// ---------------- boot ----------------
async function boot() {
  try {
    await waitForAuth();
  } catch (err) {
    appEl.innerHTML = `<div class="loading"><p>接続エラー: ${err.message}<br>js/firebase-config.js の設定を確認してください。</p></div>`;
    return;
  }
  state.screen = "profile-picker";
  render();

  subscribeKids((kids) => { state.kids = kids; render(); });
  subscribeChores((chores) => { state.chores = chores; render(); });
  subscribeRewards((rewards) => { state.rewards = rewards; render(); });
  subscribeCompletions((completions) => { state.completions = completions; render(); });
  subscribeRedemptions((redemptions) => { state.redemptions = redemptions; render(); });
  subscribeStreaks((streaks) => { state.streaks = streaks; render(); });
  subscribeBonuses((bonuses) => { state.bonuses = bonuses; render(); });
}

boot();
