// firebase_config.js
// Frontend Firebase Web SDK config only.
// Do NOT put serviceAccountKey.json or private_key here.

const firebaseConfig = {
    apiKey: "AIzaSyCzUKVset_cIvd4WWE302lua9lOalTY73E",
    authDomain: "signalbot-f2107.firebaseapp.com",
    projectId: "signalbot-f2107",
    storageBucket: "signalbot-f2107.firebasestorage.app",
    messagingSenderId: "650291705352",
    appId: "1:650291705352:web:79e04a469023aa6af983bd",
    measurementId: "G-VQZMLFKWBB"
};

firebase.initializeApp(firebaseConfig);

// Optional: use later for login/payment/user features
const auth = firebase.auth();
const db = firebase.firestore();