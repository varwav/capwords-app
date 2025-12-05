// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 🔴 请替换为你自己的 Firebase 配置信息
const firebaseConfig = {
 apiKey: "AIzaSyBOsyhIaGot9BDggVB3AZjOQ4cprEMoyM4",
  authDomain: "capwords-240bc.firebaseapp.com",
  projectId: "capwords-240bc",
  storageBucket: "capwords-240bc.firebasestorage.app",
  messagingSenderId: "59683680002",
  appId: "1:59683680002:web:daf47999d3643eeefc1c1b",
  measurementId: "G-WJRGSWD0VV"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);