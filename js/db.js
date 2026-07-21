import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function waitForAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) resolve(user);
    });
    signInAnonymously(auth).catch(reject);
  });
}

// ---------- generic helpers ----------
function subscribe(colName, cb, order = "createdAt") {
  const q = query(collection(db, colName), orderBy(order, "desc"));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    cb(items);
  });
}

// ---------- kids ----------
export const subscribeKids = (cb) => subscribe("kids", cb, "name");
export const addKid = (name, emoji) =>
  addDoc(collection(db, "kids"), { name, emoji, points: 0, createdAt: serverTimestamp() });
export const updateKid = (id, data) => updateDoc(doc(db, "kids", id), data);
export const deleteKid = (id) => deleteDoc(doc(db, "kids", id));

// ---------- chores ----------
export const subscribeChores = (cb) => subscribe("chores", cb, "name");
export const addChore = (name, points) =>
  addDoc(collection(db, "chores"), { name, points, active: true, createdAt: serverTimestamp() });
export const updateChore = (id, data) => updateDoc(doc(db, "chores", id), data);
export const deleteChore = (id) => deleteDoc(doc(db, "chores", id));

// ---------- rewards ----------
export const subscribeRewards = (cb) => subscribe("rewards", cb, "name");
export const addReward = (name, cost) =>
  addDoc(collection(db, "rewards"), { name, cost, active: true, createdAt: serverTimestamp() });
export const updateReward = (id, data) => updateDoc(doc(db, "rewards", id), data);
export const deleteReward = (id) => deleteDoc(doc(db, "rewards", id));

// ---------- completions (お手伝い申請) ----------
export const subscribeCompletions = (cb) => subscribe("completions", cb, "createdAt");
export const requestCompletion = (kid, chore) =>
  addDoc(collection(db, "completions"), {
    kidId: kid.id,
    kidName: kid.name,
    choreId: chore.id,
    choreName: chore.name,
    points: chore.points,
    status: "pending",
    createdAt: serverTimestamp(),
    decidedAt: null,
  });

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(dayKeyA, dayKeyB) {
  const a = new Date(`${dayKeyA}T00:00:00`);
  const b = new Date(`${dayKeyB}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

export async function decideCompletion(completionId, approve) {
  await runTransaction(db, async (tx) => {
    const compRef = doc(db, "completions", completionId);
    const compSnap = await tx.get(compRef);
    if (!compSnap.exists()) throw new Error("申請が見つかりません");
    const comp = compSnap.data();
    if (comp.status !== "pending") return; // already decided elsewhere

    let choreSnap = null;
    let streakRef = null;
    let streakSnap = null;
    let kidRef = null;
    let kidSnap = null;
    if (approve) {
      const choreRef = doc(db, "chores", comp.choreId);
      choreSnap = await tx.get(choreRef);
      streakRef = doc(db, "streaks", `${comp.kidId}_${comp.choreId}`);
      streakSnap = await tx.get(streakRef);
      kidRef = doc(db, "kids", comp.kidId);
      kidSnap = await tx.get(kidRef);
    }

    if (approve) {
      let newPoints = (kidSnap.exists() ? kidSnap.data().points || 0 : 0) + comp.points;

      const chore = choreSnap.exists() ? choreSnap.data() : null;
      const streakDays = chore?.streakDays || 0;
      const streakBonus = chore?.streakBonus || 0;
      let bonusAwarded = 0;
      let bonusDays = 0;

      if (streakDays > 0) {
        const doneDay = dayKey(comp.createdAt ? comp.createdAt.toDate() : new Date());
        const streakData = streakSnap.exists() ? streakSnap.data() : { currentStreak: 0, lastDoneDate: null };
        let newStreak;
        if (!streakData.lastDoneDate) {
          newStreak = 1;
        } else {
          const diff = daysBetween(streakData.lastDoneDate, doneDay);
          if (diff === 0) newStreak = streakData.currentStreak;
          else if (diff === 1) newStreak = streakData.currentStreak + 1;
          else if (diff < 0) newStreak = streakData.currentStreak;
          else newStreak = 1;
        }
        if (newStreak >= streakDays) {
          bonusAwarded = streakBonus;
          bonusDays = streakDays;
          newPoints += streakBonus;
          newStreak = 0;
        }
        tx.set(streakRef, {
          kidId: comp.kidId,
          choreId: comp.choreId,
          currentStreak: newStreak,
          lastDoneDate: doneDay,
        });
      }

      tx.update(kidRef, { points: newPoints });

      if (bonusAwarded > 0) {
        const bonusRef = doc(collection(db, "bonuses"));
        tx.set(bonusRef, {
          kidId: comp.kidId,
          kidName: comp.kidName,
          choreId: comp.choreId,
          choreName: comp.choreName,
          days: bonusDays,
          points: bonusAwarded,
          createdAt: serverTimestamp(),
        });
      }
    }
    tx.update(compRef, {
      status: approve ? "approved" : "rejected",
      decidedAt: serverTimestamp(),
    });
  });
}

// ---------- streaks (連続記録) ----------
export function subscribeStreaks(cb) {
  return onSnapshot(collection(db, "streaks"), (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    cb(items);
  });
}

// ---------- bonuses (連続ボーナス履歴) ----------
export const subscribeBonuses = (cb) => subscribe("bonuses", cb, "createdAt");

// ---------- redemptions (こうかん申請) ----------
export const subscribeRedemptions = (cb) => subscribe("redemptions", cb, "createdAt");
export const requestRedemption = (kid, reward) =>
  addDoc(collection(db, "redemptions"), {
    kidId: kid.id,
    kidName: kid.name,
    rewardId: reward.id,
    rewardName: reward.name,
    cost: reward.cost,
    status: "pending",
    createdAt: serverTimestamp(),
    decidedAt: null,
  });

export async function decideRedemption(redemptionId, approve) {
  await runTransaction(db, async (tx) => {
    const redRef = doc(db, "redemptions", redemptionId);
    const redSnap = await tx.get(redRef);
    if (!redSnap.exists()) throw new Error("申請が見つかりません");
    const red = redSnap.data();
    if (red.status !== "pending") return;

    let finalStatus = approve ? "approved" : "rejected";
    if (approve) {
      const kidRef = doc(db, "kids", red.kidId);
      const kidSnap = await tx.get(kidRef);
      const current = kidSnap.exists() ? kidSnap.data().points || 0 : 0;
      if (current < red.cost) {
        finalStatus = "rejected"; // ポイント不足なら自動的に却下扱い
      } else {
        tx.update(kidRef, { points: current - red.cost });
      }
    }
    tx.update(redRef, { status: finalStatus, decidedAt: serverTimestamp() });
  });
}
