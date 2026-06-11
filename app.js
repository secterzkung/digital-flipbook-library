let flipObj = null;
let activePdfDoc = null;
const DB_NAME = "LocalFlipbookStorage";
const STORE_NAME = "pdf_files";

// เรียกใช้งานระบบฐานข้อมูลภายในเครื่อง (IndexedDB)
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function savePdfToLocal(arrayBuffer, filename) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put({ id: "saved_book", data: arrayBuffer, name: filename });
  return new Promise((res) => tx.oncomplete = () => res());
}

async function getPdfFromLocal() {
  const db = await openDatabase();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get("saved_book");
    req.onsuccess = () => resolve(req.result);
  });
}

async function clearLocalPdf() {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete("saved_book");
  return new Promise((res) => tx.oncomplete = () => res());
}

function showLoading(status, msg = "") {
  document.getElementById("spinnerOverlay").classList.toggle("hidden", !status);
  if(msg) document.getElementById("spinnerText").textContent = msg;
}

function updateLog(msg, isErr = false) {
  const banner = document.getElementById("statusAlert");
  banner.textContent = msg;
  banner.style.color = isErr ? "#ef4444" : "#94a3b8";
}

// ฟังก์ชันวาดหน้ากระดาษ PDF ลงบน Canvas ของสมุดพลิก
async function generateFlipbook(pdfSource, bookTitleText) {
  showLoading(true, "Extracting PDF contents...");
  document.getElementById("currentFileInfo").textContent = bookTitleText;
  
  const wrapper = document.getElementById("flipbookWrapper");
  wrapper.innerHTML = ""; // ล้างข้อมูลเดิมออกก่อน
  
  if (flipObj) {
    try { flipObj.destroy(); } catch(e){}
    flipObj = null;
  }

  try {
    // โหลดไฟล์ด้วย PDF.js
    activePdfDoc = await window.pdfjsLib.getDocument(pdfSource).promise;
    const totalPages = activePdfDoc.numPages;

    // ลูปสร้างหน้ากระดาษทีละหน้าตามขนาดสัดส่วนจริงของเอกสาร
    for (let pNum = 1; pNum <= totalPages; pNum++) {
      updateLog(`Rendering page ${pNum} / ${totalPages}...`);
      const page = await activePdfDoc.getPage(pNum);
      const viewport = page.getViewport({ scale: 1.5 }); // สเกลคมชัด 1.5 เท่า

      const sheetDiv = document.createElement("div");
      sheetDiv.className = "page-sheet";
      
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      sheetDiv.appendChild(canvas);
      wrapper.appendChild(sheetDiv);

      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    }

    // เปิดใช้งานความสามารถหนังสือสมจริงด้วย StPageFlip
    showLoading(true, "Assembling 3D structural model...");
    
    // คำนวณขนาดหน้าแรกเพื่อนำไปเป็นฐานตั้งค่าระบบ
    const samplePage = await activePdfDoc.getPage(1);
    const sampleViewport = samplePage.getViewport({ scale: 1.5 });

    flipObj = new St.PageFlip(wrapper, {
      width: sampleViewport.width,
      height: sampleViewport.height,
      size: "stretch", // ยืดขยายหน้าหนังสือให้เต็มขนาดกล่องโดยสัดส่วนไม่เพี้ยน
      minWidth: 300,
      maxWidth: 2000,
      minHeight: 400,
      maxHeight: 2000,
      drawShadow: true,
      showCover: true,
      usePortrait: false
    });

    flipObj.loadFromHTML(document.querySelectorAll(".page-sheet"));
    
    document.getElementById("pageTxtIndicator").textContent = `Page 1 / ${totalPages}`;
    
    flipObj.on("flip", (e) => {
      document.getElementById("pageTxtIndicator").textContent = `Page ${e.data + 1} / ${totalPages}`;
      document.getElementById("pageDirectJump").value = e.data + 1;
    });

    showLoading(false);
    updateLog("Interactive 3D Flipbook assembled successfully.");
    return totalPages;

  } catch(err) {
    console.error(err);
    showLoading(false);
    updateLog("Error: system was unable to build this flipbook.", true);
  }
}

// ประมวลผลสร้างลิงก์สำหรับแชร์ให้คนอื่น
async function makeShareableLink() {
  const hashMode = window.location.hash;
  if (hashMode && hashMode.startsWith("#url=")) {
    // ถ้าตัวเครื่องกำลังเปิดจากลิงก์ URL อยู่แล้ว ให้ใช้ค่านั้นต่อได้เลย
    return window.location.href;
  }
  
  const saved = await getPdfFromLocal();
  if (!saved) {
    alert("กรุณาอัพโหลดไฟล์ PDF เข้าไปในเครื่องก่อน จึงจะสามารถสร้างลิงก์แชร์ได้ครับ!");
    return null;
  }
  
  showLoading(true, "Encoding document database to shareable url...");
  
  // แปลงไฟล์ Binary เครื่องเป็น Base64 ลิงก์ยาวพิเศษส่งต่อข้อมูลผ่านอินเทอร์เน็ตได้ทันที
  const bytes = new Uint8Array(saved.data);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);
  
  showLoading(false);
  const baseUrl = window.location.href.split('#')[0];
  return `${baseUrl}#data=${encodeURIComponent(saved.name)}|${base64Data}`;
}

// ฟังก์ชันเริ่มระบบ ค้นหาสถานะจากลิงก์ URL ค้นหาหน่วยความจำ หรือแสดงพื้นที่ว่าง
async function startApp() {
  const hash = window.location.hash;
  
  // ตรวจสอบเคสผู้รับลิงก์แชร์แบบ Base64 ข้อมูลติดมากับตัว
  if (hash && hash.startsWith("#data=")) {
    try {
      const payload = decodeURIComponent(hash.substring(6));
      const parts = payload.split("|");
      const filename = parts[0];
      const base64 = parts[1];
      
      updateLog("Decoding received share link package...");
      const binaryStr = atob(base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      
      await generateFlipbook({ data: bytes.buffer }, `Shared: ${filename}`);
      return;
    } catch(e) {
      updateLog("Failed to load attached share data package.", true);
    }
  }

  // ตรวจสอบเคสผู้รับลิงก์แชร์ดึงจาก Direct URL
  if (hash && hash.startsWith("#url=")) {
    const targetUrl = decodeURIComponent(hash.substring(5));
    await generateFlipbook(targetUrl, `Remote: ${targetUrl}`);
    return;
  }

  // ตรวจสอบความจำภายในเครื่องของตนเอง
  const savedFile = await getPdfFromLocal();
  if (savedFile) {
    document.getElementById("deleteSavedFileBtn").classList.remove("hidden");
    await generateFlipbook({ data: savedFile.data }, savedFile.name);
  } else {
    updateLog("Workspace ready. Awaiting digital assets submission.");
  }
}

// ผูกระบบ Event ต่างๆ เข้ากับปุ่มคำสั่งหน้าเว็บ
document.getElementById("pdfFileSelector").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || file.type !== "application/pdf") return;
  
  showLoading(true, "Reading local file structure...");
  const reader = new FileReader();
  reader.onload = async (event) => {
    const arrayBuffer = event.target.result;
    await savePdfToLocal(arrayBuffer, file.name);
    document.getElementById("deleteSavedFileBtn").classList.remove("hidden");
    await generateFlipbook({ data: arrayBuffer }, file.name);
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById("deleteSavedFileBtn").addEventListener("click", async () => {
  if (confirm("คุณแน่ใจใช่ไหมว่าต้องการลบไฟล์เล่มนี้ออกจากระบบความจำเครื่องเบราว์เซอร์?")) {
    await clearLocalPdf();
    window.location.hash = "";
    window.location.reload();
  }
});

document.getElementById("generateShareLinkBtn").addEventListener("click", async () => {
  const url = await makeShareableLink();
  if (url) {
    const area = document.getElementById("shareLinkArea");
    area.classList.remove("hidden");
    const input = document.getElementById("shareUrlInput");
    input.value = url;
    input.select();
  }
});

document.getElementById("copyUrlBtn").addEventListener("click", () => {
  const input = document.getElementById("shareUrlInput");
  input.select();
  navigator.clipboard.writeText(input.value);
  alert("คัดลอกลิงก์แชร์ไปยังคลิปบอร์ดแล้ว! สามารถนำไปกดส่งต่อให้ผู้อื่นได้ทันที");
});

document.getElementById("loadUrlBtn").addEventListener("click", async () => {
  const url = document.getElementById("directUrlInput").value.trim();
  if (!url) return;
  window.location.hash = `#url=${encodeURIComponent(url)}`;
  await generateFlipbook(url, `Remote: ${url}`);
});

// ชุดปุ่มคำสั่งเปิดหน้าหนังสือ พลิกซ้าย พลิกขวา และขยายเต็มหน้าจอ
document.getElementById("btnPrevPage").addEventListener("click", () => flipObj?.flipPrev());
document.getElementById("btnNextPage").addEventListener("click", () => flipObj?.flipNext());
document.getElementById("btnJumpPage").addEventListener("click", () => {
  const target = parseInt(document.getElementById("pageDirectJump").value);
  if (target > 0) flipObj?.flip(target - 1);
});
document.getElementById("btnToggleFullscreen").addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});
window.addEventListener("resize", () => flipObj?.update());

// เริ่มกระบวนการตรวจสอบข้อมูลเมื่อเปิดหน้าเว็บครั้งแรก
startApp();