import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBpJ5XVxudzoCJ7znGCzOc3oWjk0GoCXv0",
  authDomain: "xone-hoteles.firebaseapp.com",
  projectId: "xone-hoteles",
  storageBucket: "xone-hoteles.firebasestorage.app",
  messagingSenderId: "327215452214",
  appId: "1:327215452214:web:56cb024b312b814ac2c897",
  measurementId: "G-VY6HKW5D46"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
