<template>
  <div class="cafe-background" aria-hidden="true" />
  <div class="window-light" aria-hidden="true" />
  <div class="rain-window" aria-hidden="true" />
</template>

<style>
.cafe-background,
.window-light,
.rain-window {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.cafe-background {
  background: url('/assets/cafe-story/window-seat.webp') center / cover;
  filter: saturate(0.92) brightness(0.86);
  transition: filter 1.2s ease;
}
.window-light {
  background:
    linear-gradient(90deg, #173e4955, transparent 55%),
    radial-gradient(ellipse at 90% 18%, #dfb46b30, transparent 55%);
  opacity: 0.65;
  transition: opacity 1.2s ease;
}
.rain-window {
  inset: -50% 0 0;
  opacity: 0.1;
  background: repeating-linear-gradient(
    101deg,
    transparent 0 21px,
    #b7dce45e 21px 22px,
    transparent 23px 58px
  );
  mask-image: linear-gradient(90deg, #000, transparent 57%);
  animation: cafe-rainfall 2.6s linear infinite;
  transition: opacity 1s ease;
}
.character-stage[data-weather='rain-soft'] .rain-window {
  opacity: 0.025;
}
.character-stage[data-weather='rain-soft'] .window-light {
  opacity: 1;
}
.character-stage[data-weather='rain-soft'] .cafe-background {
  filter: saturate(0.96) brightness(0.96);
}
@keyframes cafe-rainfall {
  to {
    transform: translateY(30%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rain-window {
    animation: none;
  }
}
</style>
