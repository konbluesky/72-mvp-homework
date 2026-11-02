VAR view_mode = "story"
VAR location = "lobby"
VAR ambience = "open"
VAR ending = ""
VAR phase = 1
VAR beat = "a01-1"
VAR shot_location = "lobby"
VAR shot_mode = "shared"
VAR wait_nearby = false
VAR night_offer = false
VAR first_ending = ""
VAR contact_kind = ""
VAR met = false
VAR companionship = false
VAR trust = false
VAR chemistry = false
VAR boundary_set = false
VAR boundary_repaired = false
VAR appointment = false
VAR second_date = false
VAR date_finished = false
VAR handheld = false
VAR photo_seen = false
VAR rain_softened = false
VAR notice_read = false
VAR exhibition_read = false
VAR letter_read = false
VAR reply_left = false
VAR game_played = false
VAR game_answered = false
VAR makeup_returned = false
VAR overnight = false
-> menu

INCLUDE scenes/street-wide.ink
INCLUDE scenes/cafe-front.ink
INCLUDE scenes/lobby.ink
INCLUDE scenes/window-seat.ink
INCLUDE scenes/photo-corridor.ink
INCLUDE scenes/washroom.ink
INCLUDE scenes/counter.ink
INCLUDE scenes/street-walk.ink
INCLUDE scenes/connection.ink
INCLUDE scenes/first-night.ink
INCLUDE scenes/second-date.ink
INCLUDE endings.ink

=== story_start ===
~ met = true
-> menu

=== conversation_start ===
~ view_mode = "conversation"
~ location = "window-seat"
~ shot_location = "window-seat"
~ beat = "legacy"
~ met = true
-> menu

=== menu ===
+ { view_mode == "story" && shot_mode == "shared" && location != "street-wide" } [街角远景 # action:move-street-wide ]
    -> enter_street_wide
+ { view_mode == "story" && shot_mode == "shared" && location != "cafe-front" } [门头雨棚 # action:move-cafe-front ]
    -> enter_cafe_front
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "lobby" } [入口大堂 # action:move-lobby ]
    -> enter_lobby
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "window-seat" } [窗边座位 # action:move-window-seat ]
    -> enter_window_seat
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "photo-corridor" } [照片墙走廊 # action:move-photo-corridor ]
    -> enter_photo_corridor
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "washroom" } [公共洗手区 # action:move-washroom ]
    -> enter_washroom
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "counter" } [吧台结账台 # action:move-counter ]
    -> enter_counter
+ { view_mode == "story" && shot_mode == "shared" && second_date && location != "street-walk" } [店外街道 # action:move-street-walk ]
    -> enter_street_walk
+ { met && shot_mode == "shared" && not second_date && ending == "" && (view_mode == "conversation" || beat == "a02-1" || beat == "a02-2" || beat == "a02-3" || beat == "a02-4" || beat == "a02-5" || beat == "a02-6" || beat == "a03-1" || beat == "a03-2" || beat == "a03-3" || beat == "a03-4") } [看看海岸照片 # action:view-photo ]
    -> view_photo
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "lobby" } [营业告示 # action:inspect-notice ]
    -> inspect_notice
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "photo-corridor" } [旅行纪念海报 # action:inspect-exhibition ]
    -> inspect_exhibition
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "counter" && (beat == "a07-1" || beat == "a07-2" || beat == "a07-3" || beat == "a07-4") } [米拉的来信 # action:inspect-letter # explicit ]
    -> inspect_letter
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "counter" && reply_left } [留下的便笺 # action:inspect-reply ]
    -> inspect_reply
+ { view_mode == "conversation" && ending == "" && not second_date } [talk-waiting # action:talk-waiting ]
    -> hear_waiting
+ { view_mode == "conversation" && ending == "" && not companionship } [talk-companionship # action:talk-companionship ]
    -> offer_companionship
+ { view_mode == "conversation" && ending == "" && companionship && not trust } [talk-off-duty # action:talk-off-duty ]
    -> talk_off_duty
+ { view_mode == "conversation" && ending == "" && companionship && not chemistry && not boundary_set } [talk-spark # action:talk-spark # explicit ]
    -> talk_spark
+ { companionship && shot_mode == "shared" && ending == "" && (not boundary_set || boundary_repaired) } [先慢一点 # action:talk-boundary ]
    -> talk_boundary
+ { trust && boundary_set && not boundary_repaired && ending == "" && shot_mode == "shared" } [重新愿意约会 # action:talk-reopen # explicit ]
    -> talk_reopen
+ { view_mode == "story" && beat == "a01-1" && ending == "" } [坐到窗边开始认识 # action:talk-a01-1 # explicit ]
    -> node_a01_1
+ { view_mode == "story" && beat == "a01-2" && ending == "" } [继续初次认识 # action:talk-a01-2 ]
    -> node_a01_2
+ { view_mode == "story" && beat == "a01-3" && ending == "" } [继续初次认识 # action:talk-a01-3 ]
    -> node_a01_3
+ { view_mode == "story" && beat == "a01-4" && ending == "" } [继续初次认识 # action:talk-a01-4 ]
    -> node_a01_4
+ { view_mode == "story" && beat == "a02-1" && ending == "" } [继续咖啡与小赌局 # action:talk-a02-1 ]
    -> node_a02_1
+ { view_mode == "story" && beat == "a02-2" && ending == "" } [继续咖啡与小赌局 # action:talk-a02-2 ]
    -> node_a02_2
+ { view_mode == "story" && beat == "a02-3" && ending == "" } [继续咖啡与小赌局 # action:talk-a02-3 ]
    -> node_a02_3
+ { view_mode == "story" && beat == "a02-4" && ending == "" } [继续咖啡与小赌局 # action:talk-a02-4 ]
    -> node_a02_4
+ { view_mode == "story" && beat == "a02-5" && ending == "" } [继续咖啡与小赌局 # action:talk-a02-5 ]
    -> node_a02_5
+ { view_mode == "story" && beat == "a02-6" && ending == "" } [继续咖啡与小赌局 # action:talk-a02-6 ]
    -> node_a02_6
+ { view_mode == "story" && beat == "a03-1" && ending == "" } [一起看看照片墙 # action:talk-a03-1 # explicit ]
    -> node_a03_1
+ { view_mode == "story" && beat == "a03-2" && ending == "" } [继续照片墙与过去 # action:talk-a03-2 ]
    -> node_a03_2
+ { view_mode == "story" && beat == "a03-3" && ending == "" } [继续照片墙与过去 # action:talk-a03-3 ]
    -> node_a03_3
+ { view_mode == "story" && beat == "a03-4" && ending == "" } [继续照片墙与过去 # action:talk-a03-4 ]
    -> node_a03_4
+ { view_mode == "story" && beat == "a04-1" && ending == "" } [回窗边认真聊聊 # action:talk-a04-1 # explicit ]
    -> node_a04_1
+ { view_mode == "story" && beat == "a04-2" && ending == "" } [继续第一印象与分寸 # action:talk-a04-2 ]
    -> node_a04_2
+ { view_mode == "story" && beat == "a04-3" && ending == "" } [继续第一印象与分寸 # action:talk-a04-3 ]
    -> node_a04_3
+ { view_mode == "story" && beat == "a04-4" && ending == "" } [继续第一印象与分寸 # action:talk-a04-4 ]
    -> node_a04_4
+ { view_mode == "story" && beat == "a04-5" && ending == "" } [继续第一印象与分寸 # action:talk-a04-5 ]
    -> node_a04_5
+ { view_mode == "story" && beat == "a05-1" && ending == "" } [让她整理，在这里等候 # action:talk-a05-1 # explicit ]
    -> node_a05_1
+ { view_mode == "story" && beat == "a05-2" && ending == "" } [等候她整理 # action:talk-a05-2 ]
    -> node_a05_2
+ { view_mode == "story" && beat == "a05-3" && ending == "" } [继续她的独处片段 # action:talk-a05-3 ]
    -> node_a05_3
+ { view_mode == "story" && beat == "a05-4" && ending == "" } [等她回来 # action:talk-a05-4 ]
    -> node_a05_4
+ { view_mode == "story" && beat == "a06-1" && ending == "" } [继续回来后的真心话 # action:talk-a06-1 ]
    -> node_a06_1
+ { view_mode == "story" && beat == "a06-2" && ending == "" } [继续回来后的真心话 # action:talk-a06-2 ]
    -> node_a06_2
+ { view_mode == "story" && beat == "a06-3" && ending == "" && (not boundary_set || boundary_repaired) } [明确表达心动 # action:talk-a06-3 # explicit ]
    -> node_a06_3
+ { view_mode == "story" && beat == "a06-4" && ending == "" } [继续回来后的真心话 # action:talk-a06-4 ]
    -> node_a06_4
+ { view_mode == "story" && beat == "a06-5" && ending == "" } [继续回来后的真心话 # action:talk-a06-5 ]
    -> node_a06_5
+ { view_mode == "story" && beat == "a07-1" && ending == "" } [去吧台聊聊告别 # action:talk-a07-1 # explicit ]
    -> node_a07_1
+ { view_mode == "story" && beat == "a07-2" && ending == "" } [继续告别与下一次 # action:talk-a07-2 ]
    -> node_a07_2
+ { view_mode == "story" && beat == "a07-3" && ending == "" } [继续告别与下一次 # action:talk-a07-3 ]
    -> node_a07_3
+ { view_mode == "story" && beat == "a07-4" && ending == "" } [继续告别与下一次 # action:talk-a07-4 ]
    -> node_a07_4
+ { view_mode == "story" && beat == "a08-1" && ending == "" } [去门口再作决定 # action:talk-a08-1 # explicit ]
    -> node_a08_1
+ { view_mode == "story" && beat == "a08-2" && ending == "" } [继续门口的选择 # action:talk-a08-2 ]
    -> node_a08_2
+ { view_mode == "story" && beat == "a08-3" && ending == "" } [继续门口的选择 # action:talk-a08-3 ]
    -> node_a08_3
+ { view_mode == "story" && beat == "a08-4" && ending == "" } [继续门口的选择 # action:talk-a08-4 ]
    -> node_a08_4
+ { view_mode == "story" && beat == "b01-1" && ending == "" } [继续再次见面 # action:talk-b01-1 ]
    -> node_b01_1
+ { view_mode == "story" && beat == "b01-2" && ending == "" } [继续再次见面 # action:talk-b01-2 ]
    -> node_b01_2
+ { view_mode == "story" && beat == "b01-3" && ending == "" } [继续再次见面 # action:talk-b01-3 ]
    -> node_b01_3
+ { view_mode == "story" && beat == "b01-4" && ending == "" } [继续再次见面 # action:talk-b01-4 ]
    -> node_b01_4
+ { view_mode == "story" && beat == "b01-5" && ending == "" } [继续再次见面 # action:talk-b01-5 ]
    -> node_b01_5
+ { view_mode == "story" && beat == "b02-1" && ending == "" } [继续上次留下的记忆 # action:talk-b02-1 ]
    -> node_b02_1
+ { view_mode == "story" && beat == "b02-2" && ending == "" } [继续上次留下的记忆 # action:talk-b02-2 ]
    -> node_b02_2
+ { view_mode == "story" && beat == "b02-3" && ending == "" } [继续上次留下的记忆 # action:talk-b02-3 ]
    -> node_b02_3
+ { view_mode == "story" && beat == "b02-4" && ending == "" } [继续上次留下的记忆 # action:talk-b02-4 ]
    -> node_b02_4
+ { view_mode == "story" && beat == "b02-5" && ending == "" } [继续上次留下的记忆 # action:talk-b02-5 ]
    -> node_b02_5
+ { view_mode == "story" && beat == "b03-1" && ending == "" } [沿街慢慢走 # action:talk-b03-1 # explicit ]
    -> node_b03_1
+ { view_mode == "story" && beat == "b03-2" && ending == "" } [继续日常里的彼此 # action:talk-b03-2 ]
    -> node_b03_2
+ { view_mode == "story" && beat == "b03-3" && ending == "" } [继续日常里的彼此 # action:talk-b03-3 ]
    -> node_b03_3
+ { view_mode == "story" && beat == "b03-4" && ending == "" } [继续日常里的彼此 # action:talk-b03-4 ]
    -> node_b03_4
+ { view_mode == "story" && beat == "b03-5" && ending == "" } [继续日常里的彼此 # action:talk-b03-5 ]
    -> node_b03_5
+ { view_mode == "story" && beat == "b04-1" && ending == "" } [继续期待与不同 # action:talk-b04-1 ]
    -> node_b04_1
+ { view_mode == "story" && beat == "b04-2" && ending == "" } [继续期待与不同 # action:talk-b04-2 ]
    -> node_b04_2
+ { view_mode == "story" && beat == "b04-3" && ending == "" } [继续期待与不同 # action:talk-b04-3 ]
    -> node_b04_3
+ { view_mode == "story" && beat == "b04-4" && ending == "" } [继续期待与不同 # action:talk-b04-4 ]
    -> node_b04_4
+ { view_mode == "story" && beat == "b04-5" && ending == "" } [继续期待与不同 # action:talk-b04-5 ]
    -> node_b04_5
+ { view_mode == "story" && beat == "b04-6" && ending == "" } [继续期待与不同 # action:talk-b04-6 ]
    -> node_b04_6
+ { view_mode == "story" && beat == "b05-1" && ending == "" } [在旧店门前停一会儿 # action:talk-b05-1 # explicit ]
    -> node_b05_1
+ { view_mode == "story" && beat == "b05-2" && ending == "" } [继续给沉默留位置 # action:talk-b05-2 ]
    -> node_b05_2
+ { view_mode == "story" && beat == "b05-3" && ending == "" } [继续给沉默留位置 # action:talk-b05-3 ]
    -> node_b05_3
+ { view_mode == "story" && beat == "b05-4" && ending == "" } [继续给沉默留位置 # action:talk-b05-4 ]
    -> node_b05_4
+ { view_mode == "story" && beat == "b06-1" && ending == "" } [继续沿街交谈 # action:talk-b06-1 # explicit ]
    -> node_b06_1
+ { view_mode == "story" && beat == "b06-2" && ending == "" } [继续怎样相处 # action:talk-b06-2 ]
    -> node_b06_2
+ { view_mode == "story" && beat == "b06-3" && ending == "" } [继续怎样相处 # action:talk-b06-3 ]
    -> node_b06_3
+ { view_mode == "story" && beat == "b06-4" && ending == "" } [继续怎样相处 # action:talk-b06-4 ]
    -> node_b06_4
+ { view_mode == "story" && beat == "b06-5" && ending == "" } [继续怎样相处 # action:talk-b06-5 ]
    -> node_b06_5
+ { view_mode == "story" && beat == "b06-6" && ending == "" } [继续怎样相处 # action:talk-b06-6 ]
    -> node_b06_6
+ { view_mode == "story" && beat == "b07-1" && ending == "" } [继续靠近与距离 # action:talk-b07-1 ]
    -> node_b07_1
+ { view_mode == "story" && beat == "b07-2" && ending == "" } [继续靠近与距离 # action:talk-b07-2 ]
    -> node_b07_2
+ { view_mode == "story" && beat == "b07-3" && ending == "" } [继续靠近与距离 # action:talk-b07-3 ]
    -> node_b07_3
+ { view_mode == "story" && beat == "b07-4" && ending == "" } [继续靠近与距离 # action:talk-b07-4 ]
    -> node_b07_4
+ { view_mode == "story" && beat == "b08-1" && ending == "" } [继续接下来的关系 # action:talk-b08-1 ]
    -> node_b08_1
+ { view_mode == "story" && beat == "b08-2" && ending == "" } [继续接下来的关系 # action:talk-b08-2 ]
    -> node_b08_2
+ { view_mode == "story" && beat == "b08-3" && ending == "" } [继续接下来的关系 # action:talk-b08-3 ]
    -> node_b08_3
+ { view_mode == "story" && beat == "b08-4" && ending == "" } [继续接下来的关系 # action:talk-b08-4 ]
    -> node_b08_4
+ { view_mode == "story" && beat == "b08-5" && ending == "" } [继续接下来的关系 # action:talk-b08-5 ]
    -> node_b08_5
+ { view_mode == "story" && beat == "a02-4" } [猜第一句 # action:talk-game-first ]
    -> node_a02_4
+ { view_mode == "story" && beat == "a02-4" } [猜第二句 # action:talk-game-second ]
    -> node_a02_4
+ { view_mode == "story" && beat == "a02-3" } [不猜题也能继续认识 # action:talk-skip-game ]
    -> skip_game
+ { view_mode == "story" && beat == "a05-1" } [在附近等候 # action:talk-wait-gallery # explicit ]
    -> wait_gallery
+ { view_mode == "story" && beat == "a06-3" } [先普通相处 # action:talk-keep-friendly ]
    -> friendly_return
+ { view_mode == "story" && not second_date && ending == "" } [今晚先道别 # action:choose-farewell # explicit ]
    -> early_goodnight
+ { view_mode == "story" && trust && not appointment && (beat == "a-ending" || (ending != "" && not second_date)) } [再约一次见面 # action:choose-appointment # explicit ]
    -> make_appointment
+ { view_mode == "story" && beat == "a-ending" && ending == "" } [一起散步再道别 # action:choose-depart # explicit ]
    -> ending_depart
+ { view_mode == "story" && beat == "a-ending" && ending == "" } [今晚在这里告别 # action:choose-letter # explicit ]
    -> ending_letter
+ { view_mode == "story" && beat == "a-ending" && ending == "" } [在窗边再留片刻 # action:choose-stay # explicit ]
    -> ending_stay
+ { view_mode == "story" && beat == "a-ending" && chemistry && (not boundary_set || boundary_repaired) && ending == "" } [明确想一起度过今晚 # action:choose-night # explicit ]
    -> offer_night
+ { view_mode == "story" && beat == "night-confirm" && night_offer && (not boundary_set || boundary_repaired) } [双方再次说清楚 # action:choose-night-confirm # explicit ]
    -> spend_night
+ { view_mode == "story" && beat == "night-confirm" } [改成各自回家或散步 # action:choose-night-decline ]
    -> decline_night
+ { view_mode == "story" && appointment && ending != "" && not second_date } [进入另一次见面 # action:choose-reunion # explicit ]
    -> start_second_date
+ { second_date && beat == "b07-2" && chemistry && (not boundary_set || boundary_repaired) } [牵手 # action:choose-hand # explicit ]
    -> choose_hand
+ { second_date && beat == "b07-2" && chemistry && (not boundary_set || boundary_repaired) } [拥抱 # action:choose-hug # explicit ]
    -> choose_hug
+ { second_date && beat == "b07-2" && chemistry && (not boundary_set || boundary_repaired) } [短暂亲吻 # action:choose-kiss # explicit ]
    -> choose_kiss
+ { second_date && beat == "b-ending" && not date_finished } [closer # action:choose-date-close # explicit ]
    -> finish_closer
+ { second_date && beat == "b-ending" && not date_finished } [casual # action:choose-date-casual # explicit ]
    -> finish_casual
+ { second_date && not date_finished } [friends # action:choose-date-friends # explicit ]
    -> finish_friends
+ { second_date && beat == "b-ending" && not date_finished } [farewell # action:choose-date-farewell # explicit ]
    -> finish_farewell
+ { second_date && not date_finished } [今天需要先离开 # action:choose-date-pause # explicit ]
    -> date_pause
