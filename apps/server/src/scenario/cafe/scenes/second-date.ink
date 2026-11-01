=== start_second_date ===
~ ambience = "closed"
# cue:ambience:closed
第一晚的灯光收束。接下来的章节，是你们已经明确约好的另一次见面。
~ second_date = true
~ ending = ""
~ phase = 1
~ location = "cafe-front"
# cue:location:cafe-front
另一个双方确认能见面的雨夜。米拉来到已关闭的旧店门前，你也如约出现。
~ rain_softened = false
# cue:environment:rain
同一条街又下起雨，雨线在路灯下亮起来。
# cue:beat:reunion
{boundary_set && not boundary_repaired:
    # voice:reunionQuiet
    # thought:reunion-quiet
    她先叫住你，语气比上次熟悉，脚步却没有急着缩短你们之间的距离。
- else:
    # voice:reunionSpark
    # thought:reunion-spark
    她已经在雨棚下，看见你时没有立刻开口。那一点像是松了口气的笑，比招呼来得早。
}
-> menu

=== date_memory ===
~ date_reflected = true
# cue:beat:date-memory
{boundary_set:
    # voice:dateMemoryQuiet
    她提起上次说好的慢节奏。路灯落在肩侧，今晚有足够长的一段路，可以不用急。
- else:
    {game_answered:
        # voice:dateMemoryGame
        # thought:memory-game
        她重新提起那个小赌局，第一次把“舍不得”说成一句不打算收回的玩笑。
    - else:
        {photo_seen:
            # voice:dateMemoryPhoto
            # thought:memory-photo
            她记得你们确实一起看过那片海，把目光从照片的回忆带回眼前。
        - else:
            # voice:dateMemory
            她把上次的那句心动还给你，带着一点笑，也带着这次不想全靠玩笑遮住的认真。
        }
    }
}
-> menu

=== date_honest_talk ===
~ date_honest = true
~ phase = 2
# cue:beat:date-honesty
# voice:dateHonest
# thought:honesty
她说到一半停了停，像是也在挑一句不那么漂亮、却更真实的话。
-> menu

=== date_hold_hand ===
~ handheld = true
# cue:beat:hand-consent
# voice:hand
# thought:hand
在你问过、她也答应之后，她的手轻轻落进你掌心。雨声里，留下一点刚好的安静。
-> menu

=== ending_closer ===
~ location = "street-walk"
# cue:location:street-walk
你们走到旧店外的路灯下，第二次把一段路走成愿意继续的理由。
~ rain_softened = true
# cue:environment:rain-soft
雨势缓和，暖光仍留在路面。
~ date_finished = true
~ ending = "closer"
~ phase = 3
# cue:ending:closer
# voice:dateClose
# thought:closer
{handheld:《这次，不是顺路》：路口就在前面，你们却都没有把这段路走快。|《下一次，还是想见你》：有些靠近，是一句终于没有藏在玩笑后面的话。}
-> menu

=== ending_friends ===
~ location = "street-walk"
# cue:location:street-walk
你们沿着街道走到路口，把想说的话好好说完。
~ date_finished = true
~ ending = "friends"
~ phase = 3
# cue:ending:friends
# voice:dateFriends
# thought:friends
《好好认识，也好好告别》：你们走到路口，各自带走一个认识过的人，和一段不必后悔的夜晚。
-> menu
