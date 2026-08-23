(function(){
  'use strict';
  var last=localStorage.getItem('rt_last_context');
  var creationComplete=localStorage.getItem('rt_creation_complete')==='1';
  var block=document.querySelector('[data-returning-context]');
  if(block&&last==='job-seeker'&&creationComplete){
    var label=last==='employer'?'Corporate command center':'Resume workspace';
    var link=last==='employer'?'/employer':'/dashboard';
    block.hidden=false;
    var name=block.querySelector('[data-returning-name]');
    var action=block.querySelector('[data-returning-link]');
    if(name)name.textContent=label;
    if(action)action.href=link;
  }
  document.querySelectorAll('[data-context]').forEach(function(a){a.addEventListener('click',function(){localStorage.setItem('rt_last_context',a.dataset.context);});});
  var mobile=document.querySelector('[data-club-mobile]');
  // New luxury headers own a real dropdown. Keep the legacy inline-link toggle
  // only for older pages that have not adopted that menu yet.
  if(mobile&&!document.getElementById('clubMobileMenu'))mobile.addEventListener('click',function(){var links=document.querySelector('.club-nav__links');if(!links)return;var open=links.classList.toggle('is-open');links.style.display=open?'flex':'';mobile.setAttribute('aria-expanded',String(open));});
  document.querySelectorAll('[data-checkout-plan]').forEach(function(button){button.addEventListener('click',async function(){
    var plan=button.dataset.checkoutPlan;
    if(plan==='pro'&&typeof window.openCheckoutModal==='function'){window.openCheckoutModal();return;}
    if(plan==='lifetime'&&typeof window.openLifetimeModal==='function'){window.openLifetimeModal();return;}
    if(plan==='portal'||plan==='scale'||plan==='corporate'){location.href='/employer?plan='+plan;}
  });});
})();
