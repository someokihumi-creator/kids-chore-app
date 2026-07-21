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

export async function decideCompletion(completionId, approve) {
  await runTransaction(db, async (tx) => {
    const compRef = doc(db, "completions", completionId);
    const compSnap = await tx.get(compRef);
    if (!compSnap.exists()) throw new Error("申請が見つかりません");
    const comp = compSnap.data();
    if (comp.status !== "pending") return; // already decided elsewhere

    if (approve) {
      const kidRef = doc(db, "kids", comp.kidId);
      const kidSnap = await tx.get(kidRef);
      if (kidSnap.exists()) {
        const current = kidSnap.data().points || 0;
        tx.update(kidRef, { points: current + comp.points });
      }
    }
    tx.update(compRef, {
      status: approve ? "approved" : "rejected",
      decidedAt: serverTimestamp(),
    });
  });
}

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
