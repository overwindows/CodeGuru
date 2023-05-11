import openai
import os
from typing import List
import constants


class AzureOpenAI:
    def __init__(
            self,
            system_message: str = "You are an AI assistant that helps people find information.",
            examples: List[List[str]] = None,
            engine: str = constants.DEFAULT_AZURE_OPENAI_ENGINE,
            max_tokens: int = 15000,
            top_p: float = 0.95,
            temperature: float = 0.7,
            frequency_penalty: float = 0,
            presence_penalty: float = 0,
            stop: str = None
    ):
        self.api_type = constants.AZURE
        self.api_base = os.getenv(constants.OPENAI_API_BASE)
        self.api_version = constants.DEFAULT_OPENAI_API_VERSION
        self.api_key = os.getenv(constants.OPENAI_API_KEY)

        # Completion parameters
        self.engine = engine
        self.max_tokens = max_tokens
        self.top_p = top_p
        self.temperature = temperature
        self.frequency_penalty = frequency_penalty
        self.presence_penalty = presence_penalty
        self.stop = stop

        # initializing examples and system message
        self.system_message = system_message
        self.examples = examples

        self.initialize()

    def ask_question(self, prompt: str = None):
        response = openai.ChatCompletion.create(
            engine=self.engine,
            messages=self.__construct_messages(prompt),
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            top_p=self.top_p,
            frequency_penalty=self.frequency_penalty,
            presence_penalty=self.presence_penalty,
            stop=self.stop
        )

        return response[constants.CHOICES][0][constants.MESSAGE][constants.CONTENT]

    def initialize(self) -> None:
        openai.api_type = self.api_type
        openai.api_key = self.api_key
        openai.api_base = self.api_base
        openai.api_version = self.api_version

    def __construct_messages(self, prompt: str = None):
        messages = list()
        if self.system_message:
            messages.append({
                constants.ROLE: constants.SYSTEM,
                constants.CONTENT: self.system_message
            })
        if self.examples:
            for example in self.examples:
                assert len(example) == 2
                messages.append({
                    constants.ROLE: constants.USER,
                    constants.CONTENT: example[0]
                })
                messages.append({
                    constants.ROLE: constants.ASSISTANT,
                    constants.CONTENT: example[1]
                })

        if prompt is not None and len(prompt) > 0:
            messages.append({
                constants.ROLE: constants.USER,
                constants.CONTENT: prompt
            })

        return messages
