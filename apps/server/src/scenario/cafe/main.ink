VAR view_mode = "story"
VAR location = "lobby"
VAR ambience = "open"
VAR ending = ""
VAR phase = 1
VAR met = false
VAR companionship = false
VAR letter_read = false
VAR notice_read = false
VAR exhibition_read = false
VAR reply_left = false
VAR photo_seen = false
VAR rain_softened = false
VAR trust = false
VAR chemistry = false
VAR boundary_set = false
VAR boundary_repaired = false
VAR appointment = false
VAR second_date = false
VAR date_reflected = false
VAR date_honest = false
VAR handheld = false
VAR date_finished = false
VAR game_played = false
VAR game_answered = false
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
INCLUDE scenes/second-date.ink
INCLUDE endings.ink

=== story_start ===
~ view_mode = "story"
~ location = "lobby"
~ met = true
-> menu

=== conversation_start ===
~ view_mode = "conversation"
~ location = "window-seat"
~ met = true
-> menu

=== menu ===
+ { view_mode == "story" && not second_date && ending == "" } [今晚先说晚安 # action:choose-farewell # explicit ]
    -> early_goodnight
+ { companionship && not game_played && not second_date && ending == "" } [来个三句话的小赌局 # action:talk-game ]
    -> play_game
+ { game_played && not game_answered && not second_date && ending == "" } [猜她不爱咖啡 # action:talk-game-first ]
    -> game_first
+ { game_played && not game_answered && not second_date && ending == "" } [猜她很会认路 # action:talk-game-second ]
    -> game_second
+ { game_played && not game_answered && not second_date && ending == "" } [猜她不太会说舍不得 # action:talk-game-third ]
    -> game_third
+ { view_mode == "story" && location != "street-wide" } [回望街角 # action:move-street-wide ]
    -> enter_street_wide
+ { view_mode == "story" && location != "cafe-front" } [到雨棚下站一会儿 # action:move-cafe-front ]
    -> enter_cafe_front
+ { view_mode == "story" && not second_date && ending == "" && location != "lobby" } [回大堂 # action:move-lobby ]
    -> enter_lobby
+ { view_mode == "story" && not second_date && ending == "" && location != "window-seat" } [去窗边坐坐 # action:move-window-seat ]
    -> enter_window_seat
+ { view_mode == "story" && not second_date && ending == "" && location != "photo-corridor" } [看看照片墙 # action:move-photo-corridor ]
    -> enter_photo_corridor
+ { view_mode == "story" && not second_date && ending == "" && location != "washroom" } [到公共洗手区缓一缓 # action:move-washroom ]
    -> enter_washroom
+ { view_mode == "story" && not second_date && ending == "" && location != "counter" } [去吧台看看 # action:move-counter ]
    -> enter_counter
+ { view_mode == "story" && (second_date || ending == "depart") && location != "street-walk" } [沿街慢慢走 # action:move-street-walk ]
    -> enter_street_walk
+ { view_mode == "story" && not second_date && ending == "" && (location == "street-wide" || location == "cafe-front" || location == "lobby") } [看看营业告示 # action:inspect-notice ]
    -> inspect_notice
+ { view_mode == "story" && not second_date && ending == "" && location == "photo-corridor" } [看看旅行纪念海报 # action:inspect-exhibition ]
    -> inspect_exhibition
+ { view_mode == "story" && not second_date && ending == "" && location == "counter" } [一起看看她的信 # action:inspect-letter # explicit ]
    -> inspect_letter
+ { view_mode == "story" && not second_date && reply_left && location == "counter" } [看看今晚的落款 # action:inspect-reply ]
    -> inspect_reply
+ { met && not second_date && ending == "" && location != "street-wide" } [看看那张海岸照片 # action:view-photo ]
    -> view_photo
+ { met && not second_date && ending == "" && location != "street-wide" } [你今晚是在等谁吗 # action:talk-waiting ]
    -> hear_waiting
+ { met && not companionship && ending == "" && location != "street-wide" } [坐下来陪她聊聊 # action:talk-companionship ]
    -> offer_companionship
+ { companionship && not trust && ending == "" && location != "street-wide" } [认识工作以外的她 # action:talk-off-duty ]
    -> talk_off_duty
+ { companionship && not chemistry && not boundary_set && ending == "" && location != "street-wide" } [坦白一点心动 # action:talk-spark # explicit ]
    -> talk_spark
+ { companionship && (not boundary_set || boundary_repaired) && ending == "" } [先慢下来，普通聊天 # action:talk-boundary ]
    -> talk_boundary
+ { trust && boundary_set && not boundary_repaired && ending == "" } [明确重新愿意约会 # action:talk-reopen # explicit ]
    -> talk_reopen
+ { view_mode == "story" && trust && chemistry && (not boundary_set || boundary_repaired) && not appointment && not second_date } [专门再约一次见面 # action:choose-appointment # explicit ]
    -> make_appointment
+ { view_mode == "story" && trust && not second_date && ending == "" } [一起出去走一小段 # action:choose-depart # explicit ]
    -> ending_depart
+ { view_mode == "story" && trust && not second_date && ending == "" } [好好告别 # action:choose-letter # explicit ]
    -> ending_letter
+ { view_mode == "story" && trust && not second_date && ending == "" } [再坐一会儿，说点真的 # action:choose-stay # explicit ]
    -> ending_stay
+ { view_mode == "story" && appointment && ending != "" && not second_date } [进入约好的第二次见面 # action:choose-reunion # explicit ]
    -> start_second_date
+ { second_date && not date_reflected && not date_finished } [聊聊第一次见面的记忆 # action:talk-date-memory ]
    -> date_memory
+ { second_date && date_reflected && not date_honest && not date_finished } [把玩笑后的真心说清楚 # action:talk-date-honest ]
    -> date_honest_talk
+ { second_date && date_honest && chemistry && (not boundary_set || boundary_repaired) && not handheld && not date_finished } [问她愿不愿意牵手 # action:choose-hand # explicit ]
    -> date_hold_hand
+ { second_date && date_honest && not date_finished } [愿意继续认真约会 # action:choose-date-close # explicit ]
    -> ending_closer
+ { second_date && not date_finished } [把关系留在朋友的位置 # action:choose-date-friends # explicit ]
    -> ending_friends
