(function () {
  const drawer = document.getElementById('productDrawer');
  const form = document.getElementById('productEditor');
  const title = document.getElementById('productDrawerTitle');
  const submit = document.getElementById('saveProduct');
  function openProduct(product) {
    form.reset();
    submit.disabled = false;
    form.action = product ? '/admin/products/' + product.id : '/admin/products';
    title.textContent = product ? 'Edit Product' : 'Add Product';
    submit.textContent = product ? 'Save Changes' : 'Add Product';
    document.getElementById('activeProductField').hidden = !product;
    if (product) {
      ['name', 'barcode', 'category_id', 'unit', 'selling_price', 'cost_price', 'stock_quantity', 'reorder_level'].forEach(name => {
        form.elements[name].value = product[name] ?? '';
      });
      form.elements.active.checked = Boolean(product.active);
    }
    drawer.showModal();
    form.elements.name.focus();
  }
  document.querySelectorAll('[data-add-product]').forEach(button => button.addEventListener('click', () => openProduct()));
  document.querySelectorAll('[data-edit-product]').forEach(button => button.addEventListener('click', () => openProduct(JSON.parse(button.dataset.editProduct))));
  document.querySelectorAll('[data-open-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.openDialog).showModal()));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }));
  function filter() {
    const search = document.getElementById('catalogSearch').value.trim().toLowerCase();
    const category = document.getElementById('catalogCategory').value;
    const status = document.getElementById('catalogStatus').value;
    let visible = 0;
    document.querySelectorAll('#productsTable tbody tr').forEach(row => {
      const matchesStatus = !status || (status === 'inactive' ? row.dataset.active === 'false' : row.dataset.active === 'true' && (status === 'out' ? Number(row.dataset.stock) <= 0 : Number(row.dataset.stock) > 0 && Number(row.dataset.stock) <= Number(row.dataset.reorder)));
      row.hidden = !row.dataset.search.toLowerCase().includes(search) || Boolean(category && row.dataset.category !== category) || !matchesStatus;
      if (!row.hidden) visible++;
    });
    document.getElementById('catalogEmpty').hidden = visible > 0;
  }
  document.getElementById('catalogSearch').addEventListener('input', filter);
  document.getElementById('catalogCategory').addEventListener('change', filter);
  document.getElementById('catalogStatus').addEventListener('change', filter);
  if (location.hash === '#add') openProduct();
})();
