let flipObj = null;
let activePdfDoc = null;
const DB_NAME = "LocalFlipbookStorage";
const STORE_NAME = "pdf_files";

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
  if (banner) {
    banner.textContent = msg;
    banner.style.color = isErr ? "#ef4444" : "#94a3b8";
  }
}

async function generateFlipbook(pdfSource, bookTitleText) {
  showLoading(true, "กำลังดึงข้อมูลจากไฟล์ PDF...");
  document.getElementById("currentFileInfo").textContent = bookTitleText;
  
  const wrapper = document.getElementById("flipbookWrapper");
  wrapper.innerHTML = "";
  
  if (flipObj) {
    try { flipObj.destroy(); } catch(e){}
    flipObj = null;
  }

  try {
    activePdfDoc = await window.pdfjsLib.getDocument(pdfSource).promise;
    const totalPages = activePdfDoc.numPages;

    for (let pNum = 1; pNum <= totalPages; pNum++) {
      updateLog(`กำลังเรนเดอร์หน้ากระดาษที่ ${pNum} / ${totalPages}...`);
      const page = await activePdfDoc.getPage(pNum);
      const viewport = page.getViewport({ scale: 1.5 });

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

    showLoading(true, "กำลังจัดโครงสร้างหนังสือ 3D...");
    const samplePage = await activePdfDoc.getPage(1);
    const sampleViewport = samplePage.getViewport({ scale: 1.5 });

    flipObj = new St.PageFlip(wrapper, {
      width: sampleViewport.width,
      height: sampleViewport.height,
      size: "stretch", // ขยายตัวเล่มให้ใหญ่ที่สุดตามขนาดหน้าจอโดยสัดส่วนไม่เพี้ยน
      minWidth: 200,
      maxWidth: 2000,
      minHeight: 300,
      maxHeight: 2000,
      drawShadow: true,
      showCover: true,
      usePortrait: false
    });

    flipObj.loadFromHTML(document.querySelectorAll(".page-sheet"));
    document.getElementById("pageTxtIndicator").textContent = `หน้า 1 / ${totalPages}`;
    
    flipObj.on("flip", (e) => {
      document.getElementById("pageTxtIndicator").textContent = `หน้า ${e.data + 1} / ${totalPages}`;
      document.getElementById("pageDirectJump").value = e.data + 1;
    });

    showLoading(false);
    updateLog("สร้างหนังสือ Flipbook 3D เสร็จสมบูรณ์");
    return totalPages;

  } catch(err) {
    console.error(err);
    showLoading(false);
    updateLog("เกิดข้อผิดพลาด: ไม่สามารถเปิดอ่านไฟล์ PDF เล่มนี้ได้", true);
  }
}

async function startApp() {
  // ตรวจจับโหมดเปิดลิงก์แชร์ (?view=book) -> ถ้าใช่ ทำการซ่อนทุกอย่าง เหลือแค่หน้าหนังสือทันที
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("view") === "book") {
    document.getElementById("topNavbar").style.display = "none";
    document.getElementById("leftControlPanel").style.display = "none";
    document.getElementById("statusAlert").style.display = "none";
    
    const workspaceLayout = document.querySelector(".workspace-layout");
    if (workspaceLayout) workspaceLayout.style.height = "100vh";
  }

  const hash = window.location.hash;
  
  // รองรับการแชร์แบบ URL ตรงเสถียรสูง 100%
  if (hash && hash.startsWith("#url=")) {
    const targetUrl = decodeURIComponent(hash.substring(5));
    await generateFlipbook(targetUrl, `คลังออนไลน์: ${targetUrl.substring(targetUrl.lastIndexOf('/')+1)}`);
    return;
  }

  // โหลดไฟล์ในหน่วยความจำของบราวเซอร์ตนเอง (อัปโหลดครั้งเดียวอยู่ตลอดไป)
  const savedFile = await getPdfFromLocal();
  if (savedFile) {
    document.getElementById("deleteSavedFileBtn").classList.remove("hidden");
    await generateFlipbook({ data: savedFile.data }, savedFile.name);
  } else {
    updateLog("Workspace พร้อมใช้งาน กรุณาอัปโหลดไฟล์ PDF");
  }
}

// ควบคุมการอัปโหลดไฟล์ในเครื่องตนเอง
document.getElementById("pdfFileSelector").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || file.type !== "application/pdf") return;
  
  showLoading(true, "กำลังอ่านโครงสร้างไฟล์คอมพิวเตอร์ของคุณ...");
  const reader = new FileReader();
  reader.onload = async (event) => {
    const arrayBuffer = event.target.result;
    await savePdfToLocal(arrayBuffer, file.name);
    document.getElementById("deleteSavedFileBtn").classList.remove("hidden");
    await generateFlipbook({ data: arrayBuffer }, file.name);
  };
  reader.readAsArrayBuffer(file);
});

// ลบไฟล์ออกจากเบราว์เซอร์
document.getElementById("deleteSavedFileBtn").addEventListener("click", async () => {
  if (confirm("คุณแน่ใจใช่ไหมว่าต้องการลบไฟล์เล่มนี้ออกจากระบบความจำเครื่อง?")) {
    await clearLocalPdf();
    window.location.hash = "";
    window.location.reload();
  }
});

// ปุ่มสร้างลิงก์แชร์แบบเห็นเฉพาะหน้าหนังสือ
document.getElementById("generateUrlShareBtn").addEventListener("click", () => {
  const pdfUrl = document.getElementById("shareDirectUrlInput").value.trim();
  if (!pdfUrl) {
    alert("กรุณากรอกลิงก์ตรงของไฟล์ PDF ก่อนครับ!");
    return;
  }
  
  // แยกเอาเฉพาะ Base URL ของเว็บออกมารวมกับคำสั่งเปิดหนังสือเต็มจอ (?view=book)
  const baseUrl = window.location.href.split('?')[0].split('#')[0];
  const finalShareUrl = `${baseUrl}?view=book#url=${encodeURIComponent(pdfUrl)}`;
  
  const area = document.getElementById("shareLinkArea");
  area.classList.remove("hidden");
  const input = document.getElementById("shareUrlInput");
  input.value = finalShareUrl;
  input.select();
});

document.getElementById("copyUrlBtn").addEventListener("click", () => {
  const input = document.getElementById("shareUrlInput");
  input.select();
  navigator.clipboard.writeText(input.value);
  alert("คัดลอกลิงก์แชร์แบบเต็มหน้าจอเรียบร้อยแล้ว! สามารถส่งให้เพื่อนเปิดได้ทันทีครับ");
});

document.getElementById("loadUrlBtn").addEventListener("click", async () => {
  const url = document.getElementById("directUrlInput").value.trim();
  if (!url) return;
  window.location.hash = `#url=${encodeURIComponent(url)}`;
  await generateFlipbook(url, url);
});

// ชุดปุ่มคำสั่งควบคุมหน้ากระดาษ
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

// เริ่มต้นระบบ
startApp();