const { apiBase } = window.APP_CONFIG;
const userSelect = document.getElementById('user');
const errorBox = document.getElementById('error');

async function api(method, path, body) {
  const res = await fetch(apiBase + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-user-id': userSelect.value },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

async function render() {
  errorBox.textContent = '';
  const expenses = await api('GET', '/expenses');
  const me = Number(userSelect.value);
  document.getElementById('list').innerHTML = expenses
    .map((e) => {
      const submit = e.owner_id === me && e.status === 'draft' ? `<button data-submit="${e.id}">Submit</button>` : '';
      return `<tr><td>${e.description}</td><td>${(e.amount_cents / 100).toFixed(2)}</td><td>${e.status}</td><td>${submit}</td></tr>`;
    })
    .join('');
}

function run(action) {
  action().then(render).catch((error) => { errorBox.textContent = error.message; });
}

document.getElementById('new').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  run(() => api('POST', '/expenses', { amount_cents: Number(form.get('amount')), description: form.get('description') }));
  event.target.reset();
});

document.getElementById('list').addEventListener('click', (event) => {
  const id = event.target.dataset.submit;
  if (id) run(() => api('POST', `/expenses/${id}/submit`));
});

userSelect.addEventListener('change', () => run(async () => {}));
render();
