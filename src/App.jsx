// src/App.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Volume2, ChevronLeft, History, Loader2, Image as ImageIcon } from 'lucide-react';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { collection, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase'; // 导入本地配置

// 从环境变量获取 API Key (见下文配置)
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ... (此处保留之前的 helper functions: base64ToBlob, pcmToWav, writeString)
// 为了简洁，请将之前代码中的这三个辅助函数复制到这里

const base64ToBlob = (base64, type = 'audio/wav') => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type });
};

function pcmToWav(pcmData, sampleRate = 24000) {
    const buffer = new ArrayBuffer(44 + pcmData.byteLength);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, 1, true); 
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.byteLength, true);
    const pcmBytes = new Uint8Array(pcmData);
    const wavBytes = new Uint8Array(buffer, 44);
    wavBytes.set(pcmBytes);
    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('camera');
  const [capturedImage, setCapturedImage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultData, setResultData] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // 简化版：直接匿名登录
    signInAnonymously(auth).catch((e) => {
        console.error("Auth error", e);
        setErrorMsg("登录服务失败");
    });
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // 路径修改：直接存在用户的子集合下，不再需要 appId
    const q = collection(db, 'users', user.uid, 'vocabulary');
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setHistoryItems(items);
    });

    return () => unsubscribe();
  }, [user]);

  // ... (保留之前的 startCamera, takePicture, playPronunciation 逻辑)
  // 注意：analyzeImage 函数中的 API 调用 URL 不需要变，但 addDoc 的路径要和上面一致：
  // addDoc(collection(db, 'users', user.uid, 'vocabulary'), { ... })

  const startCamera = async () => {
    try {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' }, 
            audio: false 
        });
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => console.log("Play error:", e));
        }
        setErrorMsg('');
    } catch (err) {
        console.error("Camera error:", err);
        setErrorMsg("无法访问相机，请检查权限。");
    }
  };

  useEffect(() => {
    if (view === 'camera') startCamera();
    else if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  }, [view]);

  const takePicture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedImage(imageData);
    setView('result');
    analyzeImage(imageData);
  };

  const analyzeImage = async (base64Image) => {
    setIsProcessing(true);
    setResultData(null);
    setErrorMsg('');

    try {
      if (!API_KEY) throw new Error("请配置 VITE_GEMINI_API_KEY");

      const imageBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
      const prompt = `
        Identify the single most prominent object in this image.
        Respond with a purely valid JSON object... (同之前 Prompt)
        {
          "englishWord": "Word",
          "chineseWord": "单词",
          "ipa": "/.../",
          "emoji": "📦",
          "sentences": [
             { "en": "...", "zh": "..." }
          ]
        }
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!response.ok) throw new Error('API request failed');

      const data = await response.json();
      const parsedData = JSON.parse(data.candidates[0].content.parts[0].text);
      
      setResultData(parsedData);
      
      if (user) {
        // 路径已简化
        addDoc(collection(db, 'users', user.uid, 'vocabulary'), {
          ...parsedData,
          timestamp: serverTimestamp()
        }).catch(err => console.error("Auto-save failed", err));
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("识别失败: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };
  
  // playPronunciation 函数代码同之前，略...
  const playPronunciation = async (word) => {
      // 复制之前的逻辑，确保 API Key 使用 API_KEY 常量
      if (isPlayingAudio || !word) return;
      setIsPlayingAudio(true);
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`, {
            // ... 参数同前
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
            contents: [{ parts: [{ text: word }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
            }
            })
        });
        // ... 处理响应逻辑同前
        if (!response.ok) throw new Error('TTS request failed');
        const data = await response.json();
        const inlineData = data.candidates[0].content.parts[0].inlineData;
        if (inlineData) {
            const binaryString = atob(inlineData.data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
            const wavBuffer = pcmToWav(bytes.buffer, 24000);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => setIsPlayingAudio(false);
            audio.onerror = () => setIsPlayingAudio(false);
            await audio.play();
        } else { setIsPlayingAudio(false); }
      } catch(e) {
          console.error(e);
          const u = new SpeechSynthesisUtterance(word);
          u.lang = 'en-US';
          u.onend = () => setIsPlayingAudio(false);
          window.speechSynthesis.speak(u);
      }
  };

  // 界面组件 (CameraView, ResultView, HistoryView) 代码可以直接复制使用
  // 为了篇幅，此处省略，请将原始代码中的 View 组件部分完整复制过来
  
  // 仅需确保 View 组件内使用的变量 (如 isProcessing, resultData 等) 都能访问到
  
  const CameraView = () => (
      // ... 复制原 CameraView 代码
      <div className="relative h-full w-full bg-black flex flex-col items-center overflow-hidden">
         {/* ... */}
         {/* 记得把底部的 onClick={takePicture} 等事件绑定好 */}
         <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
         <canvas ref={canvasRef} className="hidden" />
         <div className="absolute bottom-0 w-full h-32 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center pb-8 z-20">
            <button onClick={takePicture} className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-white/20 backdrop-blur-sm active:scale-95 transition-transform">
                <div className="w-16 h-16 bg-white rounded-full"></div>
            </button>
         </div>
         {/* ... */}
      </div>
  );
  
  // ... ResultView 和 HistoryView 同理
  const ResultView = () => (
      // ... 复制原 ResultView 代码
      // 确保 img src={capturedImage} 等变量正确
      <div className="h-full w-full bg-slate-50 flex flex-col overflow-y-auto">
          {/* ... 内容略 ... */}
          {!isProcessing && resultData && (
             <div className="p-6">
                <h1 className="text-4xl font-black">{resultData.englishWord}</h1>
                {/* ... */}
             </div>
          )}
      </div>
  );

  const HistoryView = () => {
      // ... 复制原 HistoryView 及其 useMemo 逻辑
       const groupedHistory = useMemo(() => {
        const groups = {};
        historyItems.forEach(item => {
            if (!item.timestamp) return;
            const date = new Date(item.timestamp.seconds * 1000);
            const dateKey = `${date.getMonth() + 1}月 ${date.getDate()}日`;
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(item);
        });
        return groups;
    }, [historyItems]);

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col">
            {/* ... */}
             <div className="flex-1 overflow-y-auto p-6">
                {Object.entries(groupedHistory).map(([date, items]) => (
                    <div key={date}>
                        <h2>{date}</h2>
                        {/* ... items map */}
                    </div>
                ))}
             </div>
        </div>
    );
  };

  return (
    <div className="w-full h-screen bg-black flex justify-center items-center font-sans antialiased text-slate-900 selection:bg-yellow-200">
      <div className="w-full h-full max-w-md bg-white relative overflow-hidden shadow-2xl sm:rounded-3xl sm:h-[85vh] sm:border-8 sm:border-slate-800">
        {view === 'camera' && <CameraView />}
        {view === 'result' && <ResultView />}
        {view === 'history' && <HistoryView />}
      </div>
    </div>
  );
}