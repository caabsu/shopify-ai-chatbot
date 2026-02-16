import './styles/widget.css';

console.log('[ShopifyChatWidget] Hello from widget');

const container = document.createElement('div');
container.id = 'aicb-root';
container.innerHTML = '<div class="aicb-floating-btn">Chat</div>';
document.body.appendChild(container);
