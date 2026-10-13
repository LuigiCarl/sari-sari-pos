(function () {
  const cart = new Map(); // productId -> { id, name, price, qty, stock, unit }
  // Refresh stock and clear the completed cart when Back restores a cached POS page.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });

  const cartBody = document.getElementById('cartBody');
  const cartTotalEl = document.getElementById('cartTotal');
  const changeEl = document.getElementById('changeAmount');
  const amountPaidInput = document.getElementById('amountPaid');
  const itemsInput = document.getElementById('itemsInput');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const checkoutForm = document.getElementById('checkoutForm');
  const draftKey = 'pos-draft-' + checkoutForm.dataset.userId;
  const tokenInput = checkoutForm.elements.checkout_token;
  function saveDraft() {
    try {
      if (!cart.size) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, JSON.stringify({ items: [...cart.values()].map(item => ({ id: item.id, qty: item.qty })), paid: amountPaidInput.value, token: tokenInput.value }));
    } catch (_) { /* Checkout remains usable when browser storage is unavailable. */ }
  }
  const productGrid = document.getElementById('productGrid');
  const searchInput = document.getElementById('productSearch');
  const categoryFilters = document.getElementById('categoryFilters');
  const cartCount = document.getElementById('cartCount');
  const clearCart = document.getElementById('clearCart');
  const paymentStatus = document.getElementById('paymentStatus');
  const cartEmpty = document.getElementById('cartEmpty');
  clearCart.addEventListener('click', () => {
    if (!cart.size || !window.confirm('Clear all items from the cart?')) return;
    cart.clear();
    amountPaidInput.value = '';
    itemsInput.value = '';
    render();
  });
  let activeCategory = 'all';

  function peso(n) {
    return '₱' + (Number(n) / 100).toFixed(2);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Safe for use inside a double-quoted HTML attribute (escapes quotes too).
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  function addToCart(tile) {
    const id = tile.dataset.id;
    const stock = Number(tile.dataset.stock);
    if (stock <= 0) return;
    const existing = cart.get(id);
    if (existing) {
      if (existing.qty < stock) existing.qty += 1;
    } else {
      cart.set(id, {
        id,
        name: tile.dataset.name,
        price: Math.round(Number(tile.dataset.price) * 100),
        unit: tile.dataset.unit,
        stock,
        qty: 1,
      });
    }
    render();
  }

  function changeQty(id, delta) {
    const item = cart.get(id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      cart.delete(id);
    } else if (item.qty > item.stock) {
      item.qty = item.stock;
    }
    render();
  }

  function removeItem(id) {
    cart.delete(id);
    render();
  }

  function render() {
    cartBody.innerHTML = '';
    let total = 0;

    cart.forEach((item) => {
      const subtotal = item.price * item.qty;
      total += subtotal;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.name)}</td>
        <td>${peso(item.price)}</td>
        <td>
          <div class="qty-controls">
            <button type="button" data-action="dec" data-id="${item.id}" class="btn btn-small" aria-label="Decrease quantity of ${escapeAttr(item.name)}">−</button>
            <span class="qty-value">${item.qty}</span>
            <button type="button" data-action="inc" data-id="${item.id}" class="btn btn-small" aria-label="Increase quantity of ${escapeAttr(item.name)}" ${item.qty >= item.stock ? 'disabled' : ''}>+</button>
          </div>
        </td>
        <td>${peso(subtotal)}</td>
        <td><button type="button" data-action="remove" data-id="${item.id}" class="btn btn-small btn-danger" aria-label="Remove ${escapeAttr(item.name)}">✕</button></td>
      `;
      cartBody.appendChild(tr);
    });

    cartTotalEl.textContent = peso(total);
    cartCount.textContent = `${Array.from(cart.values()).reduce((sum, item) => sum + item.qty, 0)} items`;
    updateChange(total);
    clearCart.disabled = cart.size === 0;
    cartEmpty.hidden = cart.size > 0;
    saveDraft();
  }

  function updateChange(total) {
    const paid = Math.round(Number(amountPaidInput.value) * 100);
    const valid = amountPaidInput.value !== '' && Number.isFinite(paid) && paid >= 0 && amountPaidInput.validity.valid;
    const change = paid - total;
    changeEl.textContent = peso(change >= 0 ? change : 0);
    changeEl.classList.toggle('text-danger', change < 0);
    checkoutBtn.disabled = cart.size === 0 || !valid || paid < total;
    paymentStatus.textContent = !cart.size ? '' : !valid ? 'Enter a valid amount paid.' : paid < total ? `Short by: ${peso(total - paid)}` : 'Payment ready.';
    paymentStatus.classList.toggle('text-danger', cart.size > 0 && (!valid || paid < total));
  }

  cartBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'inc') changeQty(id, 1);
    if (action === 'dec') changeQty(id, -1);
    if (action === 'remove') removeItem(id);
  });

  productGrid.addEventListener('click', (e) => {
    const tile = e.target.closest('.product-tile');
    if (tile) addToCart(tile);
  });

  categoryFilters.addEventListener('click', (e) => {
    const button = e.target.closest('[data-category]');
    if (!button) return;
    activeCategory = button.dataset.category;
    categoryFilters.querySelectorAll('.category-filter').forEach((item) => item.classList.toggle('active', item === button));
    productGrid.querySelectorAll('.product-tile').forEach((tile) => {
      tile.hidden = activeCategory !== 'all' && tile.dataset.category !== activeCategory;
    });
  });

  amountPaidInput.addEventListener('input', () => {
    const total = Array.from(cart.values()).reduce((sum, i) => sum + i.price * i.qty, 0);
    updateChange(total);
    saveDraft();
  });

  checkoutForm.addEventListener('submit', (e) => {
    const total = Array.from(cart.values()).reduce((sum, item) => sum + item.price * item.qty, 0);
    updateChange(total);
    if (checkoutBtn.disabled) {
      e.preventDefault();
      return;
    }
    const items = Array.from(cart.values()).map((i) => ({ productId: Number(i.id), quantity: i.qty }));
    itemsInput.value = JSON.stringify(items);
  });

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = searchInput.value.trim();
      try {
      const res = await fetch(`/pos/api/products?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        saveDraft();
        window.location.assign('/login');
        return;
      }
      if (!res.ok) throw new Error('Unable to search products. Try again.');
      const products = await res.json();
      productGrid.innerHTML = products
        .map(
          (p) => `
        <button type="button" class="product-tile" ${Number(p.stock_quantity) <= 0 ? 'disabled' : ''} data-id="${p.id}" data-name="${escapeAttr(p.name)}" data-price="${p.selling_price}" data-stock="${p.stock_quantity}" data-unit="${escapeAttr(p.unit)}" data-category="${escapeAttr(p.category_name || '')}">
          <span class="product-name">${escapeHtml(p.name)}</span>
          <span class="product-price">${peso(Math.round(Number(p.selling_price) * 100))}</span>
          <span class="product-stock stock-badge ${Number(p.stock_quantity) <= 0 ? 'stock-out' : Number(p.stock_quantity) <= Number(p.reorder_level) ? 'stock-low' : 'stock-good'}">${Number(p.stock_quantity) <= 0 ? 'Out of stock' : p.stock_quantity + ' ' + escapeHtml(p.unit) + ' left'}</span>
        </button>`
        )
        .join('');
      productGrid.querySelectorAll('.product-tile').forEach((tile) => {
        tile.hidden = activeCategory !== 'all' && tile.dataset.category !== activeCategory;
      });
      } catch (error) {
        document.getElementById('cartRecoveryStatus').textContent = 'Unable to load products. Your cart is saved; try again.';
      }
    }, 250);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (draft && Array.isArray(draft.items)) {
      let changed = false;
      draft.items.forEach(item => {
        const tile = [...productGrid.querySelectorAll('.product-tile')].find(tile => tile.dataset.id === String(item.id));
        if (!tile || !Number.isInteger(item.qty) || item.qty <= 0 || Number(tile.dataset.stock) <= 0) { changed = true; return; }
        const stock = Number(tile.dataset.stock);
        const qty = Math.min(item.qty, stock);
        changed = changed || qty !== item.qty;
        cart.set(tile.dataset.id, { id: tile.dataset.id, name: tile.dataset.name, price: Math.round(Number(tile.dataset.price) * 100), qty, stock, unit: tile.dataset.unit });
      });
      amountPaidInput.value = typeof draft.paid === 'string' ? draft.paid : '';
      if (/^[0-9a-f-]{36}$/i.test(draft.token || '')) tokenInput.value = draft.token;
      document.getElementById('cartRecoveryStatus').textContent = changed ? 'Cart restored. Unavailable items or quantities were adjusted to current stock. Review before paying.' : 'Cart restored. Prices and stock have been refreshed.';
    }
  } catch (_) { /* Ignore invalid or unavailable drafts. */ }
  render();
})();
