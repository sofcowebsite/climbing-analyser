// Coaching for each detected cause of a fall. Written for climbers who already know the
// basics ("use your feet", "keep arms straight"): each entry explains the mechanism behind
// the fall and gives specific technical fixes plus a focused way to rehearse the move.

export const FALL_CAUSES = {
  missedCatch: {
    cue: 'Arrive with the grip already shaped and your toes pulling in. Catch, then freeze for one second before anything else.',
    title: 'Didn\'t stick the hold',
    why: 'Reaching a hold and holding it are two different jobs. At the moment of contact your fingers must stop all the momentum you built during the move. If your body is still travelling (sideways, outwards or downwards) when you arrive, the hold has to absorb that, and marginal holds can\'t.',
    fixes: [
      'Arrive with your hand already in the right grip shape (open hand for slopers, half crimp for edges, thumb ready for pinches). Adjusting after contact costs the 0.2–0.3 s you don\'t have.',
      'Keep tension through the whole move, not just the launch: toes pulling in on the footholds and core braced, so your hips don\'t sag away from the wall as you catch.',
      'Aim for the best part of the hold, not the first part you can touch. Spot it before the move, since you can\'t look for it mid-move.',
      'Engage the catching arm\'s lat (shoulder blade down) as you make contact, so the shoulder takes the load instead of the fingers alone.',
    ],
    drill: 'Rehearse the catch on its own: set up in the start position, do the move 3× touching the hold without holding it (to learn exactly where it is), then 3× committing to a full catch. Stop after each attempt and feel where your hips were.',
    moreDrills: [
      'Catch practice from below: set up one move lower than the fall, do the move before it and the catch as one motion, 4 times. The aim is to arrive with your hips already still, not to reach further.',
      'Film the catch at 0.25× and look only at your hips at the moment of contact. If they\'re still moving outward or down, do 3 goes where you finish the push before the hand arrives.',
    ],
  },
  lateCatch: {
    cue: 'Hand leaves early; arrive at the top of the motion, weightless.',
    title: 'Late catch on a dynamic move',
    why: 'In a dynamic move there\'s a brief moment at the top of your motion (the dead point) when you\'re weightless. Grab the hold then and it only has to hold you still. Grab it on the way down and it has to stop a falling body. That\'s several times more force, which most holds can\'t take.',
    fixes: [
      'Release the hand earlier: the hand should be on its way while your hips are still rising, arriving as they stop.',
      'Generate the move from your legs and a hip pop toward the wall, not by throwing the arm. If the arm does the work, it\'s too slow and arrives late.',
      'Keep the holding arm slightly bent and pulling down and in through the lat during the move. Letting it straighten early drops your centre of mass away from the wall before you catch.',
      'If you can\'t reach the hold at the dead point, the move needs more height, not more reach: a higher or better foothold, or a bigger leg drive.',
    ],
    drill: 'Dead-point ladder: on an easy wall, pick a hold just out of reach and do 5 moves where you only tap it at the exact top of your motion. Then 5 where you catch and hold. The goal is to feel weightless on contact.',
    moreDrills: [
      'Two-phase practice: do the move 3 times where you only drive with your legs and hips and let the hand float up without grabbing. Then 3 times adding the catch at the highest point.',
      'Mark the moment: a partner says "now" when your hips stop rising. Your hand should touch the hold on that word. Five tries, then swap to doing it without the call.',
    ],
  },
  overreach: {
    cue: 'One more foot move (or a drop knee) before you reach.',
    title: 'Over-extended on the catch',
    why: 'You caught the hold near full span. At full extension your shoulder and fingers are in their weakest position, and there\'s no range left to absorb the load. Even a good hold becomes hard to keep.',
    fixes: [
      'Get your hips 10–15 cm higher before the move, with one more foot move, even onto a poor smear. That turns a max-span static into a comfortable reach.',
      'Turn the hip on the reaching side into the wall (drop knee or back-step). It adds reach without moving the feet and keeps the shoulder closer to the wall.',
      'If the feet can\'t go higher, go dynamic from a lower, compressed position instead of a slow static stretch. A slow full-span move leaves nothing for the catch.',
      'Look for an intermediate: a small edge, a thumb catch or a sidepull halfway can split the move in two.',
    ],
    drill: 'Try the move three ways: (1) your original beta, (2) with one extra foot move first, (3) with a drop knee. Note which one leaves your catching arm slightly bent on contact. That\'s the beta to use.',
    moreDrills: [
      'Measure it: from the start position, reach the hold with a straight arm and note where your feet are. Then find a foot position 10 cm higher and repeat. Pick the version where you catch with a slightly bent arm.',
      'Split the move: look for any intermediate (a smear, a thumb catch, a sidepull) and try the move in two parts, 3 times. Even a poor intermediate often beats a max-span reach.',
    ],
  },
  feetCut: {
    cue: 'Toes pulling in through the whole move; brace your core on the catch.',
    title: 'Feet cut loose on the catch',
    why: 'Both feet came off as you moved, so at the catch your whole body swung out and away. The swing adds to your weight right when the new hold is least secure. It\'s one of the most common ways to fall off a hold you actually reached.',
    fixes: [
      'Toe-pull through the move: press down and actively pull the footholds toward you, as if dragging the wall closer. Keep that tension until the hand is locked.',
      'Place the feet for the direction of the catch: when moving right, the left foot should be the one loaded and pushing, so it opposes the swing.',
      'If the feet have to cut (roof, big dyno), plan for it: catch, keep the core tight and let the legs swing under the hold, then re-place a foot as the swing reverses. Don\'t fight the swing with a bent arm.',
      'Brace your core at the moment of catch (like a hanging knee raise) to stop the hips flying out.',
    ],
    drill: 'On a steep wall, do the move 5 times with the rule "feet must stay on". If a foot comes off, repeat. Then practise a controlled cut-and-recover on a big hold so a cut isn\'t a surprise.',
    moreDrills: [
      'Hover and hold: do the move and freeze with the new hold caught and both feet still on for 3 seconds. If a foot comes off, reset. Three clean reps before linking.',
      'Cut and recover: on a big hold, deliberately let the feet cut and practise putting a foot back on within half a second, 5 times. When a cut is controlled, it isn\'t a fall.',
    ],
  },
  handSlip: {
    cue: 'Set the grip, and move your hips so you pull along the hold\'s best direction.',
    title: 'Hand slid off the hold',
    why: 'Your hand came off while your feet were still on, so the grip itself failed. That usually comes down to hold type and body position (the direction you were pulling didn\'t match the hold) or friction, rather than strength.',
    fixes: [
      'Match your body to the hold\'s direction: slopers and sidepulls only work when your body is below or opposite them. Move your hips so you pull along the hold\'s best angle, not across it.',
      'Grip technique: on crimps, wrap the thumb over the index finger. On slopers, keep the wrist low and the palm high for maximum skin contact. On pinches, squeeze with the thumb as hard as the fingers.',
      'Set the grip before you weight it. After catching, give it a split second to settle before moving your next limb.',
      'Outdoors, friction is often the real limit: brush the hold, chalk before the crux, and try again in cooler, drier conditions (mornings, shade, wind).',
    ],
    drill: 'Hang the hold in the position you fell from (feet on) for 5 seconds, 3 times, trying different grip positions and hip positions. Find the one where it feels most secure.',
    moreDrills: [
      'Grip audit: hold the hold with your feet on for 5 s in three hip positions (left, centre, right of it). The one where the hold feels best tells you where your body should be when you catch it.',
      'Fresh skin, fresh try: brush, chalk, rest 3 minutes, and try the move once with full focus on setting the grip before you move your next limb.',
    ],
  },
  footSlip: {
    cue: 'Watch the foot until it\'s weighted, and keep your hips over it through the move.',
    title: 'Foot slipped first',
    why: 'A foot came off before your hands did, so the fall started at your feet. Most foot slips aren\'t about the foothold being too small. They happen when the direction of force on the foot changes mid-move, usually because the hips moved away from over the foot.',
    fixes: [
      'Keep weighting the foot through the whole move. Slips happen when your hips drift sideways or outward, which turns "pushing into the rock" into "pushing along it".',
      'On smears: drop your heel to get more rubber on the rock, and keep your hips out and over the foot. The more you lean in, the worse a smear sticks.',
      'On edges: stand on the inside edge at the big toe with a stiff ankle. Don\'t roll onto your toe tip or the outside of the shoe when you push hard.',
      'Don\'t explode off a foot you\'ve just placed. Load it progressively for half a second first, especially on polished or dusty footholds.',
      'Clean shoe rubber (wipe it on your trousers or lick-and-rub) and brush the foothold outdoors. Dusty rubber loses a lot of friction.',
    ],
    drill: '"Hover and weight": place the foot, look at it, weight it fully for 2 seconds, then make the hand move. Repeat the crux 3× like this, then at normal speed while still watching the foot until it\'s loaded.',
    moreDrills: [
      'Foot focus: on the move you slipped, keep your eyes on the foot until the hand has caught, 3 times. Then do it looking at the hand but keeping the foot pressed the same way.',
      'Heel check: on a smear, try the move with the heel 2 cm lower each time. Stop when the foot feels stuck: that\'s the angle to keep through the push.',
    ],
  },
  barnDoor: {
    cue: 'Flag the free leg (or drop knee) before you let go with the hand.',
    title: 'Barn-doored off',
    why: 'Your body rotated sideways off the wall, like a door on its hinges. It happens when your holds line up vertically (same-side hand and foot) and nothing opposes the rotation. Grip strength can\'t stop it once it starts.',
    fixes: [
      'Flag the free leg as a counterweight: stick it out behind the other leg (back-flag) or out to the side, on the side you\'re swinging away from.',
      'Switch to a drop knee or an outside edge on the loaded foot. Turning the hip into the wall locks the rotation.',
      'Create opposition: push with a foot on the opposite side from the hand you\'re holding, so there\'s a diagonal line of support instead of a vertical hinge.',
      'Shift your hips over the supporting foot before you release the other hand, not during the move.',
    ],
    drill: 'Set up in the position just before you swung. Try the move with (1) a back-flag, (2) a side flag, and (3) a drop knee. Take whichever lets you release the hand without feeling any pull to rotate.',
    moreDrills: [
      'Hinge test: before releasing the hand, lift it 1 cm off the hold. If your body starts to rotate, adjust (flag, drop knee, hip shift) until it doesn\'t, then make the move.',
      'Mirror it: set up the same position on an easy wall and practise releasing each hand with a back-flag and with a drop knee, 3 times per side, until stopping the swing is automatic.',
    ],
  },
  lockoff: {
    cue: 'Twist the hip in instead of locking off: keep the holding arm long.',
    title: 'Lock-off gave out',
    why: 'You reached from a deep lock-off, with the holding arm bent near or below 90°. That position depends on raw bicep and shoulder strength and fades within seconds, especially on the second or third try.',
    fixes: [
      'Replace the lock-off with body position: get your feet higher and rotate the hips (twist-lock or drop knee). Rotation brings the reaching shoulder up while the holding arm stays straighter.',
      'If you do have to lock off, keep the elbow tight to your ribs and the shoulder blade pulled down and back. A lock-off with the elbow flared out is much weaker.',
      'Move faster through the lock-off. The strength drains quickly, so the longer you hold it, the less you have when you reach.',
      'Train it: 3–5 sets of 5–10 s lock-off holds at 90° and 120° on a bar or hangboard, 2× a week.',
    ],
    drill: 'Film the move twice: once with your original lock-off, once with a twist-lock (hip on the holding side turned into the wall). Compare the holding arm\'s angle when the hand leaves. The straighter one is your beta.',
    moreDrills: [
      'Lock-off ladder: on a jug, lock off at 90° and reach to three imaginary holds (up, side, across) with the other hand, 3 rounds per arm. Then repeat the crux move, reaching as soon as you\'re set.',
      'Twist test: try the move three times with the hip on the holding side turned further into the wall each time. Stop at the angle where the holding arm stays straightest.',
    ],
  },
  stalled: {
    cue: 'Know the sequence before you enter the hard part, and don\'t stop inside it.',
    title: 'Stalled in the hard part',
    why: 'You stopped in the hardest position for several seconds before falling. Hanging in a strenuous position while working out the next move uses up the strength you need for the move itself.',
    fixes: [
      'Settle the sequence before you commit: on the ground, or from the last good hold below. Know which hand goes where and where the feet go.',
      'If you\'re unsure mid-crux, commit to one option decisively rather than hovering. A committed wrong guess often still goes, and hesitation almost never does.',
      'If you need a pause, take it on the last good hold before the hard section: arms straight, hips low, shaking out. Don\'t take it in the middle of the hard move.',
    ],
    drill: 'Rehearse the crux in isolation (start from the move before it) until you can do it three times in a row without stopping. Then link it from the start.',
    moreDrills: [
      'Clock it: time how long you spend on the crux holds. Try to halve it on the next go, even if that means guessing a foot. Speed through hard sections is a skill you can practise.',
      'Ground rehearsal: stand under the crux and mime the full sequence three times, hands and feet, until you can do it without pausing. Then climb it.',
    ],
  },
  pump: {
    cue: 'Shake out before the hard section, then climb it fast.',
    title: 'Pumped out',
    why: 'Your forearms were overloaded: arms bent much of the time you held still, a long time on the wall, and little proper rest. Pump comes from time spent gripping, not from the number of moves.',
    fixes: [
      'Rest earlier and better: shake out on the last good hold before the hard section. Alternate hands every 5–10 s, arm straight, and let the resting hand hang below heart level.',
      'Climb faster through sustained sections. Less time on each hold means less pump. Keep moving on the bad holds and save the rests for the good ones.',
      'Grip only as hard as you need to. Over-gripping easy holds is a common hidden cause of pump. Relax your fingers on the jugs.',
      'Breathe out through the hard moves. Holding your breath raises the tension and speeds up the pump.',
    ],
    drill: 'For endurance: 4×4s (four problems back-to-back, 4 rounds) or 20–30 min of continuous easy climbing (ARC), twice a week. On your next attempt, plan exactly where you\'ll shake out before the crux.',
    moreDrills: [
      'Rest rehearsal: climb to the last good hold before the crux and practise a proper shake-out there (arm straight, swap hands every 5–10 s) for 30 s. Then try the crux from there.',
      'Shorten the time: climb the section before the crux again, but 20% faster. Less time gripping means less pump when you arrive at the hard bit.',
    ],
  },
  unclear: {
    cue: 'Try one change at a time: grip, hand position, then hip position.',
    title: 'No clear cause from body movement',
    why: 'Your feet were on, you weren\'t swinging and the reach wasn\'t extreme, so the body positions don\'t point to one cause. The likely culprit is the contact with the hold itself (grip position, friction, or the exact spot you grabbed), which the camera can\'t see well enough.',
    fixes: [
      'Watch the replay at 0.25× and focus only on the hand on the hold: did it land on the best part? Did it move after landing?',
      'Try the move with a different grip, or a thumb catch, or grabbing 2–3 cm to the side.',
      'Check the conditions: warm, humid or dusty rock makes marginal holds unusable. Brush, chalk, and retry when it\'s cooler.',
    ],
    drill: 'Do the move three times from the position just before, changing only one thing each time (grip, hand position, hip position), and note which feels most secure.',
    moreDrills: [
      'Watch it back: in the replay at 0.25×, look for anything that changed in the half second before the fall (a hand moving on the hold, the hips shifting, a foot rolling). Try the move changing only that.',
      'Easy version first: do the same move on the nearest easier holds so you learn the body position, then go back to the real holds.',
    ],
  },
};
