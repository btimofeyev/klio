update public.artifacts
set content = content || jsonb_build_object(
  'practice',
  $practice$
  {
    "version": 2,
    "subject": "Algebra I",
    "skill_key": "algebra.graph-linear-equations",
    "level_band": "9",
    "instructions": "Use the quiz correction as your starting point. Identify the structure, show the conversion, and graph by selecting two points.",
    "mastery_percent": 75,
    "activities": [
      {
        "id": "identify-slope-intercept",
        "type": "multiple_choice",
        "prompt": "For y = -1/2x + 4, which slope and y-intercept should you use?",
        "choices": ["m = -1/2, b = 4", "m = 1/2, b = 4", "m = -1/2, b = -4", "m = 4, b = -1/2"],
        "correct_answer": "m = -1/2, b = 4",
        "hints": ["In y = mx + b, m is the slope and b is the y-intercept."],
        "explanation": "The coefficient of x is -1/2, and the constant term is the y-intercept 4."
      },
      {
        "id": "graph-negative-slope",
        "type": "graph_line",
        "prompt": "Graph y = -1/2x + 4 by selecting two points on the coordinate plane.",
        "expected_slope": -0.5,
        "expected_y_intercept": 4,
        "x_min": -6,
        "x_max": 6,
        "y_min": -6,
        "y_max": 6,
        "hints": ["Plot (0, 4), then move right 2 and down 1."],
        "explanation": "A correct line crosses the y-axis at 4 and falls 1 unit for every 2 units moved right."
      },
      {
        "id": "convert-standard-form",
        "type": "short_answer",
        "prompt": "Rewrite 2x + y = 5 in slope-intercept form.",
        "accepted_answers": ["y=-2x+5", "-2x+5"],
        "placeholder": "y = mx + b",
        "hints": ["Subtract 2x from both sides."],
        "explanation": "Subtracting 2x gives y = -2x + 5."
      },
      {
        "id": "graph-converted-line",
        "type": "graph_line",
        "prompt": "Convert 3x + 2y = 6, then graph the resulting line by selecting two points.",
        "expected_slope": -1.5,
        "expected_y_intercept": 3,
        "x_min": -6,
        "x_max": 6,
        "y_min": -6,
        "y_max": 6,
        "hints": ["The converted equation is y = -3/2x + 3."],
        "explanation": "The line y = -3/2x + 3 crosses at 3 and falls 3 units for every 2 units moved right."
      },
      {
        "id": "explain-negative-slope",
        "type": "written_response",
        "prompt": "Jacob originally missed a negative-slope graph. Explain how you can check that a graph really has a negative slope.",
        "success_criteria": ["Describe what happens to y as x increases.", "Refer to the line falling from left to right.", "Connect the direction to a negative value of m."],
        "placeholder": "Explain your check in 2–4 sentences.",
        "max_length": 700,
        "hints": ["Imagine tracing the line from left to right."],
        "explanation": "A parent can review whether the explanation connects increasing x, decreasing y, and a negative slope."
      }
    ]
  }
  $practice$::jsonb
)
where id = 'd78f221a-2489-4109-8940-2fcd8774c47f';
