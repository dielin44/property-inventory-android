const MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json',
]);
const CHUNK_SIZE = 96 * 1024;
const pending = new Map();

// Called by Android only after saving completes, is cancelled, or fails.
window.inventoryNativeExportResult = result => {
  const operation = pending.get(result?.id);
  if (!operation) return;
  pending.delete(result.id);
  if (result.status === 'success') operation.resolve(true);
  else if (result.status === 'cancel') operation.resolve(false);
  else operation.reject(new Error(result.error || '無法儲存檔案'));
};

export async function saveFile(blob, filename) {
  const bridge = window.InventoryAndroid;
  if (!bridge) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  if (!MIME_TYPES.has(blob.type)) throw new Error('不支援的匯出格式');
  if (blob.size > 200 * 1024 * 1024) throw new Error('檔案超過 200MB，請分成多份清冊');
  const id = bridge.startExport(filename, blob.type, blob.size);
  if (!id) throw new Error('另一個檔案仍在儲存，請完成或取消後再試');
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      if (!bridge.appendExport(id, btoa(binary))) throw new Error('檔案傳輸中斷，請再試一次');
    }
    let rejectPending;
    const saved = new Promise((resolve, reject) => {
      rejectPending = reject;
      pending.set(id, {resolve, reject});
    });
    if (!bridge.finishExport(id)) {
      pending.delete(id);
      rejectPending(new Error('無法開啟儲存視窗'));
    }
    return await saved;
  } catch (error) {
    pending.delete(id);
    bridge.cancelExport(id);
    throw error;
  }
}
