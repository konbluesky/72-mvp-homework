=== enter_window_seat ===
~ location = "window-seat"
# cue:location:window-seat
{boundary_set && not boundary_repaired:窗边还是原来的位置。她给安静和距离都留出空间。|{chemistry:玻璃上映着两人的轮廓。她望过来，没有急着把目光移走。|桌上的咖啡冒着一点热气。窗上有倒影，也有足够容纳两个人的沉默。}}
-> menu

=== hear_waiting ===
# cue:beat:off-duty-arrival
# voice:waiting
她望了一眼原本空着的座位，再看回来，像是临时决定把今晚的安排改一改。
-> menu

=== offer_companionship ===
~ companionship = true
# cue:beat:companionship
# voice:comfort
她给你留出位置。窗上倒影多了一个，沉默也没有刚才那么空。
-> menu

=== view_photo ===
~ photo_seen = true
# cue:photo:travel_photo_01
# voice:photo
海岸照片在你眼前展开。明亮的海面与窗外的雨夜刚好相反，她等着你的第一句话。
{ view_mode == "conversation" && not rain_softened:
    ~ rain_softened = true
    # cue:environment:rain-soft
    # voice:rain
    雨窗上的水痕稀疏下来。她看了看外面，又把注意力留回这张桌子。
}
-> menu
