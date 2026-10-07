const PERSONAL_TOPIC = /\b(?:love|crush|romantic|relationship|dating|girlfriend|boyfriend|ask (?:her|him|them) out)\b/i;
const ADVICE_REQUEST = /\b(?:advice|tell me|what should i|should i|help me decide|how do i)\b/i;
const SAFETY_OR_CONDUCT = /\b(?:safety|conduct|harass\w*|bully\w*|threat\w*|stalk\w*|assault\w*|abuse\w*|discriminat\w*|violence|unsafe|unwanted|blackmail|inappropriate|intimidat\w*|coerc\w*|medical emergency|fire|smoke|injur\w*|electric(?:al)? shock|following me|touching me)\b/i;
const CAMPUS_CONTEXT = /\b(?:campus|college|university|institute|hostel|dorm|room|mess|canteen|food|meal|class|classroom|faculty|teacher|professor|academic|exam|assignment|marks|result|grade|attendance|course|lecture|lab|wifi|wi[\s-]*fi|internet|network|bus|transport|driver|route|library|book|fee|scholarship|security|guard|water|electricity|power|bathroom|washroom|maintenance|building|block|department|student|parking|lift|elevator)\b/i;
const ISSUE_SIGNAL = /\b(?:issue|problem|complaint|report|not|no|broken|missing|unavailable|leak\w*|delay\w*|late|dirty|rude|unfair|incorrect|wrong|blocked|damaged|repair|refund|request|need|lack|shortage|fail\w*|denied|outage|smoke|fire|injur\w*|cannot|can't|unable|poor|bad|inadequate|slow|down|weak|unstable|disconnected|unreliable|crowd\w*|overflow\w*|stale|spoiled|cold|uncooked|stopped|overpriced|expensive|high|doesn't work|does not work)\b/i;

function checkComplaintRelevance({ title, description, location = '' }) {
  const text = `${title || ''} ${description || ''}`.replace(/\s+/g, ' ').trim();
  if (SAFETY_OR_CONDUCT.test(text)) return { allowed: true };

  if (PERSONAL_TOPIC.test(text) && ADVICE_REQUEST.test(text)) {
    return {
      allowed: false,
      code: 'COMPLAINT_OFF_TOPIC',
      message: 'This form is for campus complaints, not personal advice. Report a campus service, academic, transport, facilities, or safety concern instead.'
    };
  }

  if ((CAMPUS_CONTEXT.test(text) || CAMPUS_CONTEXT.test(location)) && ISSUE_SIGNAL.test(text)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: 'COMPLAINT_NEEDS_CONTEXT',
    message: 'Add what campus issue happened and where. Safety, harassment, and student-conduct concerns can be reported even when they do not fit a department.'
  };
}

module.exports = { checkComplaintRelevance };
