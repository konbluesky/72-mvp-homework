VAR view_mode = "story"
VAR location = "street-wide"
VAR ambience = "open"
VAR ending = ""
VAR phase = 0
VAR met = false
VAR waiting_heard = false
VAR companionship = false
VAR letter_read = false
VAR letter_reflected = false
VAR notice_read = false
VAR exhibition_read = false
VAR reply_left = false
VAR photo_seen = false
VAR rain_softened = false
VAR lobby_seen = false
VAR counter_seen = false
-> menu

INCLUDE scenes/street-wide.ink
INCLUDE scenes/cafe-front.ink
INCLUDE scenes/lobby.ink
INCLUDE scenes/window-seat.ink
INCLUDE scenes/photo-corridor.ink
INCLUDE scenes/washroom.ink
INCLUDE scenes/counter.ink
INCLUDE scenes/street-walk.ink
INCLUDE endings.ink

=== story_start ===
~ view_mode = "story"
~ location = "lobby"
~ met = true
~ lobby_seen = true
~ phase = 1
-> menu

=== conversation_start ===
~ view_mode = "conversation"
~ location = "window-seat"
~ met = true
~ phase = 1
-> menu

=== menu ===
+ { view_mode == "story" && ( location != "street-wide" ) } [回望街角 # action:move-street-wide ]
    -> enter_street_wide
+ { view_mode == "story" && ( location != "cafe-front" ) } [走近咖啡馆 # action:move-cafe-front ]
    -> enter_cafe_front
+ { view_mode == "story" && ( location != "lobby" ) } [走进大堂 # action:move-lobby ]
    -> enter_lobby
+ { view_mode == "story" && ( met && location != "street-wide" && location != "window-seat" ) } [回窗边坐坐 # action:move-window-seat ]
    -> enter_window_seat
+ { view_mode == "story" && ( met && location != "street-wide" && location != "photo-corridor" ) } [看看照片墙 # action:move-photo-corridor ]
    -> enter_photo_corridor
+ { view_mode == "story" && ( met && location != "street-wide" && location != "washroom" ) } [去公共洗手区 # action:move-washroom ]
    -> enter_washroom
+ { view_mode == "story" && ( met && location != "street-wide" && location != "counter" ) } [去吧台看看 # action:move-counter ]
    -> enter_counter
+ { view_mode == "story" && ( ending == "depart" && location != "street-walk" ) } [回到街道 # action:move-street-walk ]
    -> enter_street_walk
+ { view_mode == "story" && ( location == "street-wide" || location == "cafe-front" || location == "lobby" ) } [看看营业告示 # action:inspect-notice ]
    -> inspect_notice
+ { view_mode == "story" && ( location == "photo-corridor" ) } [看看联展海报 # action:inspect-exhibition ]
    -> inspect_exhibition
+ { view_mode == "story" && ( location == "counter" ) } [问她能否打开信 # action:inspect-letter # explicit ]
    -> inspect_letter
+ { view_mode == "story" && ( location == "counter" && reply_left ) } [重看留下的回信 # action:inspect-reply ]
    -> inspect_reply
+ { met && location != "street-wide" } [问问那张照片 # action:view-photo ]
    -> view_photo
+ { met && not waiting_heard && location != "street-wide" && ending == "" } [愿意说说你在等谁吗 # action:talk-waiting ]
    -> hear_waiting
+ { met && not companionship && location != "street-wide" && ending == "" } [不急，我陪你坐一会儿 # action:talk-companionship ]
    -> offer_companionship
+ { letter_read && not letter_reflected && ending == "" } [你读完信是什么感受 # action:talk-letter-reflection ]
    -> reflect_letter
+ { view_mode == "story" && ( met && phase >= 2 && ending == "" ) } [一起出去走走 # action:choose-depart # explicit ]
    -> ending_depart
+ { view_mode == "story" && ( met && phase >= 2 && ending == "" ) } [留下回信再告别 # action:choose-letter # explicit ]
    -> ending_letter
+ { view_mode == "story" && ( met && phase >= 2 && ending == "" ) } [再坐一杯 # action:choose-stay # explicit ]
    -> ending_stay
