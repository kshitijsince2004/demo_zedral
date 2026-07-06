package com.zedral.m1operator.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val LightColorScheme = lightColorScheme(
    primary = ZedralGreen,
    secondary = ZedralSurface,
    tertiary = ZedralGold,
    background = ZedralBackground,
    surface = ZedralSurface,
    onPrimary = ZedralBackground,
    onSecondary = ZedralText,
    onTertiary = ZedralText,
    onBackground = ZedralText,
    onSurface = ZedralText,
    outline = ZedralBorder,
    error = Destructive
)

@Composable
fun ZedralTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // Currently primary layout is light theme as per industrial requirements
    val colorScheme = LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
