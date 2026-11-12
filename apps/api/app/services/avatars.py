"""注册时随机分配的头像池。

池子只是「前端 424 张预设头像」里均匀抽出的 60 张，写死在代码里，
避免后端依赖前端静态目录；用户随后可以在顶栏换成任意一张，
后端只按文件名正则校验，不依赖这份清单。
"""

from __future__ import annotations

import secrets

AVATAR_POOL: tuple[str, ...] = (
    "a1-cloud-messenger.png",
    "alarm-clock.png",
    "astronaut-coral.png",
    "baby-goat-playful.png",
    "bao-bun-2.png",
    "bear-round-face-left.png",
    "binoculars-3.png",
    "bombardier-beetle.png",
    "bubble-submarine.png",
    "calico-inspired-cat-2.png",
    "carbuncle-creature.png",
    "cheese-wheel.png",
    "classic-koala.png",
    "coffee-mug-2.png",
    "coral-polyp.png",
    "crab.png",
    "curiousfox.png",
    "deer.png",
    "dog-single-chest-patch-right.png",
    "duck.png",
    "elephant-bright-eyed.png",
    "fennec-fox-5.png",
    "foraminifera.png",
    "frog-4.png",
    "gentle-chick.png",
    "giraffe-shy-peek.png",
    "greater-bilby.png",
    "happy-panda.png",
    "hole-punch.png",
    "ili-pika-2.png",
    "kelpie-foal-2.png",
    "laboratory-hotplate.png",
    "lhasa-apso-dog.png",
    "lotus.png",
    "maltese.png",
    "markhor.png",
    "momentum-wheel.png",
    "moonstone-mole-fae.png",
    "musical-note-creature.png",
    "octopus-7.png",
    "otter-low-face-left.png",
    "panda-2.png",
    "peacock-2.png",
    "penguin.png",
    "pincushion.png",
    "popcorn.png",
    "pumpkin-3.png",
    "raccoon-3.png",
    "rain-puddle-spirit.png",
    "rhino-3.png",
    "rock-tumbler.png",
    "rubber-duck.png",
    "scorpionfly.png",
    "secretary-bird.png",
    "short-beaked-echidna.png",
    "smooth-cheek-bear.png",
    "space-station.png",
    "star-nosed-mole.png",
    "sushi-roll.png",
    "teapot-14.png",
)


def random_avatar() -> str:
    return secrets.choice(AVATAR_POOL)
