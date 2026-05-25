import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase Web-Config: bewusst öffentlich (steht ohnehin in jedem Browser-Bundle).
// Schutz läuft über Auth + Firestore Security Rules.
const firebaseConfig = {
  apiKey: "AIzaSyBjcUs-NXaSSw38bJtCfn2J2Oiln7tsd2U",
  authDomain: "stockwaage-132b6.firebaseapp.com",
  projectId: "stockwaage-132b6",
  storageBucket: "stockwaage-132b6.firebasestorage.app",
  messagingSenderId: "841643672876",
  appId: "1:841643672876:web:7597a9604ebeab569f5889",
};

export const ownerUid = "F1k284u9bmbJcOkEqt7O8BNOLN53";

let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0]!;
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
