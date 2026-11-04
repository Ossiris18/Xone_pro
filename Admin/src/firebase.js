import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBpJ5XVxudzoCJ7znGCzOc3oWjk0GoCXv0",
  authDomain: "xone-hoteles.firebaseapp.com",
  projectId: "xone-hoteles",
  storageBucket: "xone-hoteles.firebasestorage.app",
  messagingSenderId: "327215452214",
  appId: "1:327215452214:web:56cb024b312b814ac2c897",
  measurementId: "G-VY6HKW5D46"
};

// --- APP PRINCIPAL ---
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// --- APP SECUNDARIA (Clon silencioso para registrar staff sin cerrar sesión del Admin) ---
const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
export const secondaryAuth = getAuth(secondaryApp);
export const storage = getStorage(app);
