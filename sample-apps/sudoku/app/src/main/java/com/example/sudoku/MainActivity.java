package com.example.sudoku;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import gg.now.bridge.ProviderService;

/** The board, a number pad, and four buttons. */
public class MainActivity extends Activity {

    private static final int BLOCK_SHADE = 0xFFEFEFEF;
    private static final int PLAIN = Color.WHITE;
    private static final int SELECTED = 0xFFBBDEFB;
    private static final int CLUE_TEXT = 0xFF212121;
    private static final int ENTERED_TEXT = 0xFF1565C0;
    private static final int CONFLICT_TEXT = 0xFFC62828;

    private static volatile MainActivity current;

    private final SudokuBoard board = new SudokuBoard();
    private final TextView[] cells = new TextView[SudokuBoard.CELLS];

    private TextView status;
    private int selected = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        current = this;
        status = findViewById(R.id.status);
        buildGrid();
        buildPad();

        ProviderService.start(this, board);

        findViewById(R.id.newGame).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                board.newGame();
                selected = -1;
                show("New puzzle");
            }
        });
        findViewById(R.id.restart).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                board.restart();
                show("Cleared your entries");
            }
        });
        findViewById(R.id.hint).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                int at = board.hint();
                selected = at;
                show(at < 0 ? "Nothing to fill in" : "Filled " + describe(at));
            }
        });
        findViewById(R.id.solve).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                show(board.solve() ? "Solved" : "Your entries make it unsolvable");
            }
        });

        refresh();
    }

    /** One TextView per cell, sized so the board fills the screen width. */
    private void buildGrid() {
        GridLayout grid = findViewById(R.id.grid);
        int side = getResources().getDisplayMetrics().widthPixels;
        int cell = (side - dp(40)) / SudokuBoard.SIZE;

        for (int i = 0; i < SudokuBoard.CELLS; i++) {
            final int index = i;
            TextView view = new TextView(this);
            view.setGravity(Gravity.CENTER);
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);

            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = cell;
            params.height = cell;
            // A hairline gap that the dark GridLayout background shows through as grid lines.
            params.setMargins(1, 1, 1, 1);
            view.setLayoutParams(params);

            view.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    selected = index;
                    show(board.isGiven(index) ? describe(index) + " is a clue" : null);
                }
            });

            cells[i] = view;
            grid.addView(view);
        }
    }

    /** Keys 1-9 and a clear key, sharing one listener. */
    private void buildPad() {
        LinearLayout pad = findViewById(R.id.pad);
        View.OnClickListener keys = new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                enter((Integer) v.getTag());
            }
        };

        for (int value = 1; value <= SudokuBoard.SIZE; value++) {
            pad.addView(key(String.valueOf(value), value, keys));
        }
        pad.addView(key("X", 0, keys));
    }

    private Button key(String label, int value, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTag(value);
        button.setPadding(0, 0, 0, 0);
        button.setOnClickListener(listener);
        button.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        return button;
    }

    private void enter(int value) {
        if (selected < 0) {
            show("Pick a cell first");
            return;
        }
        if (!board.set(selected, value)) {
            show(describe(selected) + " is a clue");
            return;
        }
        show(board.isSolved() ? "Solved" : null);
    }

    /** Repaints every cell from the board and updates the status line. */
    private void refresh() {
        for (int i = 0; i < SudokuBoard.CELLS; i++) {
            TextView view = cells[i];
            int value = board.get(i);
            view.setText(value == 0 ? "" : String.valueOf(value));

            boolean given = board.isGiven(i);
            view.setTypeface(Typeface.DEFAULT, given ? Typeface.BOLD : Typeface.NORMAL);
            view.setTextColor(board.conflicts(i) ? CONFLICT_TEXT : (given ? CLUE_TEXT : ENTERED_TEXT));

            int row = i / SudokuBoard.SIZE;
            int col = i % SudokuBoard.SIZE;
            boolean shaded = ((row / 3) + (col / 3)) % 2 == 0;
            view.setBackgroundColor(i == selected ? SELECTED : (shaded ? BLOCK_SHADE : PLAIN));
        }
    }

    /** Repaints, and shows either the given message or the remaining count. */
    private void show(String message) {
        refresh();
        if (message != null) {
            status.setText(message);
        } else if (board.isSolved()) {
            status.setText("Solved");
        } else {
            status.setText(board.blanks() + " to go");
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        current = null;
    }

    static void refreshBoard() {
        final MainActivity activity = current;
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.show(null);
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        board.reportStateChange();
    }

    private static String describe(int index) {
        return "R" + (index / SudokuBoard.SIZE + 1) + "C" + (index % SudokuBoard.SIZE + 1);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
