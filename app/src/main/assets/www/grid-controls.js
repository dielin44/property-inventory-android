/** Touch, pointer and keyboard controls for inventory grid dimensions and swaps. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEFAULT_WIDTHS = {serial:55, name:175, photo:112, quantity:88, notes:180};
const columnWidth = column => clamp(Number(column?.width) || DEFAULT_WIDTHS[column?.id] || 130, column?.id === 'photo' ? 72 : 48, 600);
const rowHeight = row => clamp(Number(row?.height) || 104, 64, 320);

export function mountGridControls(table, {
  columns = [], rows = [],
  onColumnResize = () => {}, onRowResize = () => {},
  onSwapColumns = () => {}, onSwapRows = () => {},
  onChooseColumnSwap = () => {}, onChooseRowSwap = () => {},
} = {}) {
  let destroyed = false, interaction = null;
  const scrollParent = table.parentElement;
  const listeners = [];
  const listen = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    listeners.push(() => node.removeEventListener(type, handler, options));
  };
  const byId = (items, id) => items.find(item => String(item.id) === id);
  const choose = (kind, id) => kind === 'column' ? onChooseColumnSwap(id) : onChooseRowSwap(id);
  const swap = (kind, first, second) => {
    if (first && second && first !== second) {
      if (kind === 'column') onSwapColumns(first, second);
      else onSwapRows(first, second);
    }
  };
  function clearDrop() {
    table.querySelectorAll('.grid-drop-target').forEach(node => node.classList.remove('grid-drop-target'));
  }
  function findDrop(kind, x, y, sourceId) {
    const hit = document.elementFromPoint(x, y);
    const target = hit?.closest(kind === 'column' ? 'th[data-col-id]' : 'tbody tr[data-row]');
    if (!target || !table.contains(target)) return null;
    const id = kind === 'column' ? target.dataset.colId : target.dataset.row;
    return id === sourceId ? null : {node:target, id};
  }
  function finishActive() {
    if (!interaction) return null;
    const active = interaction;
    interaction = null;
    cancelAnimationFrame(active.frame);
    active.handle.removeEventListener('pointermove', active.move);
    active.handle.removeEventListener('pointerup', active.up);
    active.handle.removeEventListener('pointercancel', active.cancel);
    active.handle.removeEventListener('lostpointercapture', active.lost);
    try { if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId); } catch {}
    table.classList.remove('grid-dragging', 'grid-resizing');
    active.handle.classList.remove('grid-control-active');
    clearDrop();
    return active;
  }
  function startResize(event, handle, kind, id) {
    const item = byId(kind === 'column' ? columns : rows, id);
    if (!item) return;
    const min = kind === 'column' ? id === 'photo' ? 72 : 48 : 64;
    const max = kind === 'column' ? 600 : 320;
    const startValue = kind === 'column' ? columnWidth(item) : rowHeight(item);
    const callback = kind === 'column' ? onColumnResize : onRowResize;
    const startPosition = kind === 'column' ? event.clientX : event.clientY;
    const active = {handle, pointerId:event.pointerId, frame:0, value:startValue};
    active.move = current => {
      if (current.pointerId !== active.pointerId || destroyed) return;
      current.preventDefault();
      const position = kind === 'column' ? current.clientX : current.clientY;
      active.value = Math.round(clamp(startValue + position - startPosition, min, max));
      handle.setAttribute('aria-valuenow', active.value);
      callback(id, active.value, false);
    };
    const commit = current => {
      if (current && current.pointerId !== active.pointerId) return;
      if (interaction !== active) return;
      finishActive();
      callback(id, active.value, true);
    };
    active.up = commit;
    active.cancel = commit;
    active.lost = commit;
    interaction = active;
    handle.classList.add('grid-control-active');
    table.classList.add('grid-resizing');
    handle.addEventListener('pointermove', active.move);
    handle.addEventListener('pointerup', active.up);
    handle.addEventListener('pointercancel', active.cancel);
    handle.addEventListener('lostpointercapture', active.lost);
    handle.setPointerCapture(event.pointerId);
  }
  function startSwap(event, handle, kind, id) {
    const active = {
      handle, pointerId:event.pointerId, frame:0, moved:false,
      x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, target:null,
    };
    function updateTarget() {
      clearDrop();
      active.target = findDrop(kind, active.x, active.y, id);
      active.target?.node.classList.add('grid-drop-target');
    }
    function autoscroll() {
      if (destroyed || interaction !== active) return;
      if (active.moved) {
        let scrolled = false;
        if (kind === 'column' && scrollParent) {
          const rect = scrollParent.getBoundingClientRect(), edge = 42;
          let amount = 0;
          if (active.x < rect.left + edge) amount = -Math.min(18, (rect.left + edge - active.x) / 3);
          else if (active.x > rect.right - edge) amount = Math.min(18, (active.x - rect.right + edge) / 3);
          if (amount) {
            const before = scrollParent.scrollLeft;
            scrollParent.scrollLeft += amount;
            scrolled = before !== scrollParent.scrollLeft;
          }
        } else if (kind === 'row') {
          const edge = 70;
          let amount = 0;
          if (active.y < edge) amount = -Math.min(16, (edge - active.y) / 4);
          else if (active.y > window.innerHeight - edge) amount = Math.min(16, (active.y - window.innerHeight + edge) / 4);
          if (amount) {
            const before = window.scrollY;
            window.scrollBy(0, amount);
            scrolled = before !== window.scrollY;
          }
        }
        if (scrolled) updateTarget();
      }
      active.frame = requestAnimationFrame(autoscroll);
    }
    active.move = current => {
      if (current.pointerId !== active.pointerId || destroyed) return;
      current.preventDefault();
      active.x = current.clientX; active.y = current.clientY;
      if (!active.moved && Math.hypot(active.x - active.startX, active.y - active.startY) >= 6) {
        active.moved = true;
        table.classList.add('grid-dragging');
      }
      if (active.moved) updateTarget();
    };
    active.up = current => {
      if (current.pointerId !== active.pointerId || interaction !== active) return;
      active.x = current.clientX; active.y = current.clientY;
      if (active.moved) updateTarget();
      const targetId = active.target?.id;
      finishActive();
      if (active.moved) swap(kind, id, targetId);
      else choose(kind, id);
    };
    active.cancel = current => {
      if (current.pointerId === active.pointerId && interaction === active) finishActive();
    };
    active.lost = () => { if (interaction === active) finishActive(); };
    interaction = active;
    handle.classList.add('grid-control-active');
    handle.addEventListener('pointermove', active.move);
    handle.addEventListener('pointerup', active.up);
    handle.addEventListener('pointercancel', active.cancel);
    handle.addEventListener('lostpointercapture', active.lost);
    handle.setPointerCapture(event.pointerId);
    active.frame = requestAnimationFrame(autoscroll);
  }
  function controlFrom(target) {
    if (!(target instanceof Element)) return null;
    const node = target.closest('[data-resize-col],[data-resize-row],[data-drag-col],[data-drag-row]');
    return node && table.contains(node) ? node : null;
  }
  listen(table, 'pointerdown', event => {
    if (destroyed || event.button !== 0 || interaction) return;
    const handle = controlFrom(event.target);
    if (!handle) return;
    event.preventDefault(); event.stopPropagation();
    if (handle.dataset.resizeCol !== undefined) startResize(event, handle, 'column', handle.dataset.resizeCol);
    else if (handle.dataset.resizeRow !== undefined) startResize(event, handle, 'row', handle.dataset.resizeRow);
    else if (handle.dataset.dragCol !== undefined) startSwap(event, handle, 'column', handle.dataset.dragCol);
    else startSwap(event, handle, 'row', handle.dataset.dragRow);
  });
  listen(table, 'dragstart', event => { if (controlFrom(event.target)) event.preventDefault(); });
  listen(table, 'click', event => {
    if (destroyed || interaction || event.detail !== 0) return;
    const handle = controlFrom(event.target);
    if (handle?.dataset.dragCol !== undefined) { event.preventDefault(); choose('column', handle.dataset.dragCol); }
    else if (handle?.dataset.dragRow !== undefined) { event.preventDefault(); choose('row', handle.dataset.dragRow); }
  });
  listen(table, 'keydown', event => {
    if (destroyed || interaction) return;
    const handle = controlFrom(event.target);
    if (!handle) return;
    const isColumnResize = handle.dataset.resizeCol !== undefined, isRowResize = handle.dataset.resizeRow !== undefined;
    if (isColumnResize || isRowResize) {
      const kind = isColumnResize ? 'column' : 'row';
      const id = isColumnResize ? handle.dataset.resizeCol : handle.dataset.resizeRow;
      const item = byId(isColumnResize ? columns : rows, id);
      if (!item) return;
      const lower = isColumnResize ? 'ArrowLeft' : 'ArrowUp', higher = isColumnResize ? 'ArrowRight' : 'ArrowDown';
      if (event.key !== lower && event.key !== higher) return;
      event.preventDefault(); event.stopPropagation();
      const amount = (event.shiftKey ? 24 : 8) * (event.key === lower ? -1 : 1);
      const value = isColumnResize ? clamp(columnWidth(item) + amount, id === 'photo' ? 72 : 48, 600) : clamp(rowHeight(item) + amount, 64, 320);
      if (kind === 'column') onColumnResize(id, value, true); else onRowResize(id, value, true);
      return;
    }
    const kind = handle.dataset.dragCol !== undefined ? 'column' : 'row';
    const id = kind === 'column' ? handle.dataset.dragCol : handle.dataset.dragRow;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); choose(kind, id); return;
    }
    const items = kind === 'column' ? columns : rows;
    const lower = kind === 'column' ? 'ArrowLeft' : 'ArrowUp', higher = kind === 'column' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== lower && event.key !== higher) return;
    event.preventDefault(); event.stopPropagation();
    const index = items.findIndex(item => String(item.id) === id);
    const other = index + (event.key === lower ? -1 : 1);
    if (index >= 0 && other >= 0 && other < items.length) swap(kind, id, String(items[other].id));
  });
  table.querySelectorAll('[data-resize-col],[data-resize-row],[data-drag-col],[data-drag-row]').forEach(handle => {
    handle.style.touchAction = 'none'; handle.draggable = false;
    if (handle.dataset.resizeCol !== undefined) {
      const column = byId(columns, handle.dataset.resizeCol);
      handle.setAttribute('aria-valuemin', column?.id === 'photo' ? '72' : '48');
      handle.setAttribute('aria-valuemax', '600');
      handle.setAttribute('aria-valuenow', columnWidth(column));
    } else if (handle.dataset.resizeRow !== undefined) {
      handle.setAttribute('aria-valuemin', '64'); handle.setAttribute('aria-valuemax', '320');
      handle.setAttribute('aria-valuenow', rowHeight(byId(rows, handle.dataset.resizeRow)));
    }
  });
  return {destroy() { if (destroyed) return; destroyed = true; finishActive(); listeners.forEach(remove => remove()); }};
}
